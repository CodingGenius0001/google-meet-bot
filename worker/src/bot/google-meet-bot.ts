import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { MeetingEndReason, MeetingStatus } from "@prisma/client";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page
} from "playwright";

import { logger } from "../utils/logger";

export type TranscriptSegment = {
  speaker: string;
  text: string;
  capturedAt: string;
};

export type MeetingRunResult = {
  finalStatus: MeetingStatus;
  endReason: MeetingEndReason;
  joinedAt: Date | null;
  startedAt: Date;
  endedAt: Date;
  captionsEnabled: boolean;
  participantsPeak: number;
  transcriptSegments: TranscriptSegment[];
  transcriptText: string | null;
  recordingPath: string | null;
};

type BotOptions = {
  jobId: string;
  meetUrl: string;
};

const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS ?? 180000);
const SOLO_GRACE_PERIOD_MS = Number(process.env.SOLO_GRACE_PERIOD_MS ?? 60000);
const DEFAULT_GUEST_NAME = process.env.GOOGLE_MEET_GUEST_NAME?.trim() || "MeetMate Bot";

export class GoogleMeetBot {
  private readonly transcriptSegments: TranscriptSegment[] = [];
  private readonly seenCaptionKeys = new Set<string>();
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private recorderProcess: ChildProcess | null = null;

  constructor(private readonly options: BotOptions) {}

  async run() {
    const startedAt = new Date();

    await this.launch();
    await this.openMeeting();
    await this.dismissPopups();
    await this.disableMediaInputs();
    await this.fillGuestNameIfNeeded();
    await this.joinMeeting();
    await this.waitUntilAdmitted();

    const joinedAt = new Date();
    const captionsEnabled = await this.enableCaptions();
    const recordingPath = await this.startRecording();
    const result = await this.monitorMeeting(startedAt, joinedAt, captionsEnabled, recordingPath);

    return result;
  }

  async cleanup() {
    await this.stopRecording();

    await this.context?.close().catch((error: unknown) => {
      logger.warn("Unable to close browser context cleanly.", error);
    });

    await this.browser?.close().catch((error: unknown) => {
      logger.warn("Unable to close browser cleanly.", error);
    });

    this.context = null;
    this.browser = null;
    this.page = null;
  }

  private async launch() {
    const storageState = await resolveStorageState();
    const browserArgs = [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--window-size=1440,960"
    ];

    if (!storageState) {
      logger.warn(
        "No Google auth state was found. The bot will try to join as a guest if the meeting allows guests or admits join requests."
      );
    }

    if (
      process.platform === "linux" &&
      typeof process.getuid === "function" &&
      process.getuid() === 0
    ) {
      browserArgs.push("--no-sandbox", "--disable-setuid-sandbox");
      logger.warn("Chromium is running as root. Sandbox protections are disabled for compatibility.");
    }

    this.browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS === "true",
      args: browserArgs
    });

    this.context = await this.browser.newContext({
      permissions: ["microphone", "camera", "notifications"],
      viewport: { width: 1440, height: 960 },
      storageState
    });

    this.page = await this.context.newPage();

    await this.page.exposeFunction("meetBotCaptureCaption", async (segment: TranscriptSegment) => {
      const speaker = segment.speaker.trim() || "Unknown";
      const text = segment.text.trim();

      if (!text) {
        return;
      }

      const key = `${speaker}:${text}`;

      if (this.seenCaptionKeys.has(key)) {
        return;
      }

      this.seenCaptionKeys.add(key);
      this.transcriptSegments.push({
        speaker,
        text,
        capturedAt: segment.capturedAt
      });
    });
  }

  private getPage() {
    if (!this.page) {
      throw new Error("Browser page is not initialized.");
    }

    return this.page;
  }

  private async openMeeting() {
    const page = this.getPage();

    await page.goto(this.options.meetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(3000);
  }

  private async dismissPopups() {
    const page = this.getPage();
    const popupButtons = [/got it/i, /dismiss/i, /continue without microphone/i, /close/i];

    for (const name of popupButtons) {
      const button = page.getByRole("button", { name }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => null);
      }
    }
  }

  private async disableMediaInputs() {
    await this.toggleOffIfNeeded(/microphone|mic/i);
    await this.toggleOffIfNeeded(/camera/i);
  }

  private async toggleOffIfNeeded(name: RegExp) {
    const page = this.getPage();
    const button = page.getByRole("button", { name }).first();

    if (!(await button.isVisible().catch(() => false))) {
      return;
    }

    const ariaLabel = ((await button.getAttribute("aria-label")) ?? "").toLowerCase();
    const pressed = (await button.getAttribute("aria-pressed"))?.toLowerCase();
    const looksEnabled =
      ariaLabel.includes("turn off") ||
      ariaLabel.includes("on") ||
      ariaLabel.includes("stop") ||
      pressed === "true";

    if (looksEnabled) {
      await button.click().catch(() => null);
      await page.waitForTimeout(300);
    }
  }

  private async enableCaptions() {
    const page = this.getPage();
    const button = page.getByRole("button", { name: /captions|turn on captions/i }).first();

    if (!(await button.isVisible().catch(() => false))) {
      return false;
    }

    await button.click().catch(() => null);
    await this.installCaptionObserver();
    return true;
  }

  private async installCaptionObserver() {
    const page = this.getPage();

    await page.evaluate(() => {
      const globalWindow = window as Window & {
        meetBotCaptureCaption?: (segment: {
          speaker: string;
          text: string;
          capturedAt: string;
        }) => Promise<void>;
        __meetBotCaptionObserver?: MutationObserver;
      };

      globalWindow.__meetBotCaptionObserver?.disconnect();

      const capture = () => {
        const nodes = Array.from(
          document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]')
        );

        for (const node of nodes) {
          const text = node.textContent?.trim();

          if (!text || text.length < 6) {
            continue;
          }

          const parts = text
            .split(/\n+/)
            .map((part) => part.trim())
            .filter(Boolean);

          const speaker = parts.length > 1 ? parts[0] : "Unknown";
          const spokenText = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];

          globalWindow.meetBotCaptureCaption?.({
            speaker,
            text: spokenText,
            capturedAt: new Date().toISOString()
          });
        }
      };

      const observer = new MutationObserver(capture);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      capture();
      globalWindow.__meetBotCaptionObserver = observer;
    });
  }

  private async joinMeeting() {
    const page = this.getPage();
    const joinButton = page.getByRole("button", { name: /join now|ask to join/i }).first();

    if (!(await joinButton.isVisible().catch(() => false))) {
      throw new Error(
        "No Google Meet join button was visible. The page may require guest access to be enabled or a signed-in Google session."
      );
    }

    await joinButton.click();
  }

  private async fillGuestNameIfNeeded() {
    const page = this.getPage();
    const candidates = [
      page.getByRole("textbox", { name: /your name/i }).first(),
      page.locator('input[aria-label*="name" i]').first(),
      page.locator('input[placeholder*="name" i]').first(),
      page.locator('input[type="text"]').first()
    ];

    for (const input of candidates) {
      if (!(await input.isVisible().catch(() => false))) {
        continue;
      }

      const currentValue = ((await input.inputValue().catch(() => "")) ?? "").trim();

      if (!currentValue) {
        await input.fill(DEFAULT_GUEST_NAME).catch(() => null);
        await page.waitForTimeout(300);
      }

      return;
    }
  }

  private async waitUntilAdmitted() {
    const page = this.getPage();
    const deadline = Date.now() + JOIN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await this.isInMeeting()) {
        return;
      }

      if (await this.pageHasText(/you can't join this call|meeting code is invalid|denied|removed/i)) {
        throw new Error("The bot was not allowed into the meeting.");
      }

      await page.waitForTimeout(2000);
    }

    throw new Error("Timed out waiting to be admitted into the meeting.");
  }

  private async isInMeeting() {
    const page = this.getPage();
    const leaveButton = page.getByRole("button", { name: /leave call|leave/i }).first();
    return leaveButton.isVisible().catch(() => false);
  }

  private async startRecording() {
    if (process.platform !== "linux") {
      logger.warn("Recording is only enabled in the Linux worker container. Skipping local capture.");
      return null;
    }

    if (process.env.WORKER_DISABLE_RECORDING === "true") {
      logger.warn("Recording was disabled during worker startup. Skipping local capture.");
      return null;
    }

    const outputDir = path.resolve(process.cwd(), "worker", "output");
    const outputPath = path.join(outputDir, `${this.options.jobId}-${Date.now()}.mp4`);
    const scriptPath = path.resolve(process.cwd(), "worker", "scripts", "start-recording.sh");

    await mkdir(outputDir, { recursive: true });

    this.recorderProcess = spawn("bash", [scriptPath, outputPath], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.recorderProcess.stdout?.on("data", (data: Buffer) => {
      logger.info("Recorder", data.toString().trim());
    });

    this.recorderProcess.stderr?.on("data", (data: Buffer) => {
      logger.warn("Recorder stderr", data.toString().trim());
    });

    await this.getPage().waitForTimeout(1500);
    return outputPath;
  }

  private async stopRecording() {
    if (!this.recorderProcess) {
      return;
    }

    const recorder = this.recorderProcess;
    this.recorderProcess = null;

    recorder.kill("SIGINT");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        recorder.kill("SIGKILL");
        resolve();
      }, 5000);

      recorder.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async monitorMeeting(
    startedAt: Date,
    joinedAt: Date,
    captionsEnabled: boolean,
    recordingPath: string | null
  ) {
    const page = this.getPage();
    let participantsPeak = 1;
    let soloSince: number | null = null;

    while (true) {
      const participantCount = await this.readParticipantCount();
      participantsPeak = Math.max(participantsPeak, participantCount ?? participantsPeak);

      if (await this.pageHasText(/you've been removed from the meeting|removed from the meeting/i)) {
        return this.finalizeRun({
          startedAt,
          joinedAt,
          captionsEnabled,
          participantsPeak,
          recordingPath,
          finalStatus: MeetingStatus.KICKED,
          endReason: MeetingEndReason.BOT_KICKED
        });
      }

      if (await this.pageHasText(/meeting has ended|call ended|this call has ended/i)) {
        return this.finalizeRun({
          startedAt,
          joinedAt,
          captionsEnabled,
          participantsPeak,
          recordingPath,
          finalStatus: MeetingStatus.ENDED_ROOM_CLOSED,
          endReason: MeetingEndReason.ROOM_ENDED
        });
      }

      const alone =
        participantCount !== null
          ? participantCount <= 1
          : await this.pageHasText(/only one here|no one else is here|you're the only one here/i);

      if (alone) {
        soloSince ??= Date.now();

        if (Date.now() - soloSince >= SOLO_GRACE_PERIOD_MS) {
          return this.finalizeRun({
            startedAt,
            joinedAt,
            captionsEnabled,
            participantsPeak,
            recordingPath,
            finalStatus: MeetingStatus.ENDED_EMPTY,
            endReason: MeetingEndReason.LAST_PARTICIPANT_LEFT
          });
        }
      } else {
        soloSince = null;
      }

      if (!(await this.isInMeeting())) {
        return this.finalizeRun({
          startedAt,
          joinedAt,
          captionsEnabled,
          participantsPeak,
          recordingPath,
          finalStatus: MeetingStatus.ENDED_ROOM_CLOSED,
          endReason: MeetingEndReason.UNKNOWN
        });
      }

      await page.waitForTimeout(5000);
    }
  }

  private async readParticipantCount() {
    const page = this.getPage();

    return page
      .evaluate(() => {
        const values = Array.from(document.querySelectorAll("button, div"))
          .map((element) => {
            const label = element.getAttribute("aria-label") ?? "";
            const text = element.textContent ?? "";
            return `${label} ${text}`.trim();
          })
          .filter(Boolean);

        for (const value of values) {
          const match = value.match(/participants?|people/i);

          if (!match) {
            continue;
          }

          const digitMatch = value.match(/\d+/);
          const numeric = digitMatch ? Number(digitMatch[0]) : Number.NaN;

          if (!Number.isNaN(numeric)) {
            return numeric;
          }
        }

        return null;
      })
      .catch(() => null);
  }

  private async pageHasText(pattern: RegExp) {
    const bodyText = (await this.getPage().locator("body").textContent().catch(() => "")) ?? "";
    return pattern.test(bodyText);
  }

  private async finalizeRun({
    startedAt,
    joinedAt,
    captionsEnabled,
    participantsPeak,
    recordingPath,
    finalStatus,
    endReason
  }: {
    startedAt: Date;
    joinedAt: Date;
    captionsEnabled: boolean;
    participantsPeak: number;
    recordingPath: string | null;
    finalStatus: MeetingStatus;
    endReason: MeetingEndReason;
  }): Promise<MeetingRunResult> {
    await this.stopRecording();

    return {
      finalStatus,
      endReason,
      joinedAt,
      startedAt,
      endedAt: new Date(),
      captionsEnabled,
      participantsPeak,
      transcriptSegments: this.transcriptSegments,
      transcriptText:
        this.transcriptSegments.length > 0
          ? this.transcriptSegments
              .map(
                (segment) =>
                  `[${segment.capturedAt}] ${segment.speaker}: ${segment.text}`
              )
              .join("\n")
          : null,
      recordingPath
    };
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveStorageState(): Promise<BrowserContextOptions["storageState"] | undefined> {
  const encoded = process.env.GOOGLE_MEET_STORAGE_STATE_BASE64?.trim();

  if (encoded) {
    try {
      const json = Buffer.from(encoded, "base64").toString("utf8");
      return JSON.parse(json) as NonNullable<BrowserContextOptions["storageState"]>;
    } catch (error) {
      logger.warn("Unable to parse GOOGLE_MEET_STORAGE_STATE_BASE64.", error);
    }
  }

  const authStatePath = process.env.GOOGLE_MEET_STORAGE_STATE_PATH;

  if (authStatePath && (await fileExists(authStatePath))) {
    return authStatePath;
  }

  return undefined;
}
