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

export class CancelledError extends Error {
  constructor(message = "Session was cancelled by the user before joining.") {
    super(message);
    this.name = "CancelledError";
  }
}

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
  /**
   * Called once the bot has been admitted to the meeting and the local
   * recorder has been started. The runner uses this to flip the DB row
   * from JOINING to LIVE so the dashboard can reflect the actual state.
   * Errors thrown from the callback are caught and logged — they must
   * never break the bot's main flow.
   */
  onJoined?: (info: { joinedAt: Date; recordingPath: string | null }) => Promise<void> | void;
};

const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS ?? 180000);
const SOLO_GRACE_PERIOD_MS = Number(process.env.SOLO_GRACE_PERIOD_MS ?? 60000);
const DEFAULT_GUEST_NAME = process.env.GOOGLE_MEET_GUEST_NAME?.trim() || "MeetMate Bot";
// Hard cap so a stuck monitor loop or unresponsive Meet UI can never produce
// an unbounded recording. Default 4h.
const MAX_RECORDING_DURATION_MS = Math.max(
  60_000,
  Number(process.env.MAX_RECORDING_DURATION_MS ?? 4 * 60 * 60 * 1000) || 4 * 60 * 60 * 1000
);

export class GoogleMeetBot {
  private readonly transcriptSegments: TranscriptSegment[] = [];
  private readonly seenCaptionKeys = new Set<string>();
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private recorderProcess: ChildProcess | null = null;
  private recordingTimeoutTimer: NodeJS.Timeout | null = null;
  private recordingHardStopReached = false;
  // Set by the worker's heartbeat loop when the dashboard user clicks
  // "Stop session". The monitor loop polls this flag and exits cleanly.
  private cancelRequested = false;

  constructor(private readonly options: BotOptions) {}

  /**
   * Signal the bot that the user wants to stop the session. Safe to call
   * from any thread/timer — the monitor loop picks it up on its next tick.
   */
  requestCancel() {
    this.cancelRequested = true;
  }

  hasCancelRequest() {
    return this.cancelRequested;
  }

  async run() {
    const startedAt = new Date();

    // Fast-path cancel check between each setup phase. Once monitorMeeting
    // starts it has its own in-loop check.
    const checkCancel = () => {
      if (this.cancelRequested) {
        throw new CancelledError();
      }
    };

    await this.launch();
    checkCancel();
    await this.openMeeting();
    checkCancel();
    await this.dismissPopups();
    await this.disableMediaInputs();
    await this.fillGuestNameIfNeeded();
    checkCancel();
    await this.joinMeeting();
    checkCancel();
    await this.waitUntilAdmitted();
    checkCancel();

    const joinedAt = new Date();
    const captionsEnabled = await this.enableCaptions();
    const recordingPath = await this.startRecording();

    // Notify the runner that we're fully admitted and recording so it can
    // update the DB row to LIVE. Swallow errors — callback failures must
    // never prevent the meeting from being monitored.
    if (this.options.onJoined) {
      try {
        await this.options.onJoined({ joinedAt, recordingPath });
      } catch (error) {
        logger.warn("onJoined callback failed.", error);
      }
    }

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
    // Keep the viewport in sync with the Xvfb display / recording capture
    // size so ffmpeg's x11grab sees the full Chromium window. These fall
    // back to the start-worker.sh / start-recording.sh defaults.
    const captureWidth = Number.parseInt(process.env.RECORDING_WIDTH ?? "1280", 10) || 1280;
    const captureHeight = Number.parseInt(process.env.RECORDING_HEIGHT ?? "720", 10) || 720;
    const browserArgs = [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      `--window-size=${captureWidth},${captureHeight}`
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
      viewport: { width: captureWidth, height: captureHeight },
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

    this.recorderProcess.on("error", (error) => {
      logger.error("Recorder process error.", error);
    });

    this.recorderProcess.stdout?.on("data", (data: Buffer) => {
      logger.info("Recorder", data.toString().trim());
    });

    this.recorderProcess.stderr?.on("data", (data: Buffer) => {
      // FFmpeg writes everything to stderr, including its periodic progress
      // line ("frame= 1489 fps= 24 ... speed=0.98x"). Those are not warnings —
      // filter them out and send only actual notices to WARN level.
      const text = data.toString().trim();
      if (!text) {
        return;
      }
      const isProgressLine = /^(frame=|size=)/.test(text);
      if (isProgressLine) {
        logger.debug("Recorder progress", text);
        return;
      }
      logger.info("Recorder", text);
    });

    // Hard cap on recording duration. If the monitor loop ever hangs or Meet
    // never produces an end-of-call signal, this guarantees the FFmpeg child
    // is terminated and the worker can move on.
    this.recordingHardStopReached = false;
    this.recordingTimeoutTimer = setTimeout(() => {
      this.recordingHardStopReached = true;
      logger.warn("Recording exceeded MAX_RECORDING_DURATION_MS — terminating recorder.", {
        maxMs: MAX_RECORDING_DURATION_MS
      });
      this.stopRecording().catch((error) => {
        logger.warn("Forced recorder stop failed.", error);
      });
    }, MAX_RECORDING_DURATION_MS);
    if (typeof (this.recordingTimeoutTimer as { unref?: () => void }).unref === "function") {
      (this.recordingTimeoutTimer as { unref: () => void }).unref();
    }

    await this.getPage().waitForTimeout(1500);
    return outputPath;
  }

  hasReachedRecordingLimit() {
    return this.recordingHardStopReached;
  }

  private async stopRecording() {
    if (this.recordingTimeoutTimer) {
      clearTimeout(this.recordingTimeoutTimer);
      this.recordingTimeoutTimer = null;
    }

    if (!this.recorderProcess) {
      return;
    }

    const recorder = this.recorderProcess;
    this.recorderProcess = null;

    try {
      recorder.kill("SIGINT");
    } catch (error) {
      logger.warn("Recorder SIGINT failed.", error);
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          recorder.kill("SIGKILL");
        } catch (error) {
          logger.warn("Recorder SIGKILL failed.", error);
        }
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
    // Require isInMeeting() to fail this many consecutive polls before
    // treating the bot as ejected. A single failure can happen when Meet
    // relayouts the control bar (e.g. captions toggle, panel open), and
    // we do NOT want to bail on a UI flicker.
    const NOT_IN_MEETING_EXIT_THRESHOLD = 3;
    let notInMeetingStreak = 0;

    while (true) {
      if (this.cancelRequested) {
        logger.info("Cancel request received — leaving the meeting.", {
          jobId: this.options.jobId
        });
        return this.finalizeRun({
          startedAt,
          joinedAt,
          captionsEnabled,
          participantsPeak,
          recordingPath,
          finalStatus: MeetingStatus.COMPLETED,
          endReason: MeetingEndReason.CANCELLED
        });
      }

      if (this.recordingHardStopReached) {
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

      const participantCount = await this.readParticipantCount();
      participantsPeak = Math.max(participantsPeak, participantCount ?? participantsPeak);

      // DOM-scoped signal checks. Previously we did regex-on-body-text,
      // which matched caption text as soon as the user turned captions
      // on — any caption containing "removed", "ended", "call ended"
      // etc. immediately killed the session. These helpers look in
      // headings / dialogs / specific Meet controls instead.
      if (await this.hasKickedSignal()) {
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

      if (await this.hasRoomEndedSignal()) {
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
          : await this.hasSoloSignal();

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

      if (await this.isInMeeting()) {
        notInMeetingStreak = 0;
      } else {
        notInMeetingStreak += 1;
        if (notInMeetingStreak >= NOT_IN_MEETING_EXIT_THRESHOLD) {
          logger.warn("Leave button missing for multiple consecutive ticks — exiting monitor.", {
            jobId: this.options.jobId,
            threshold: NOT_IN_MEETING_EXIT_THRESHOLD
          });
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
      }

      await page.waitForTimeout(5000);
    }
  }

  /**
   * Look for Meet's specific "you've been removed" signal rather than
   * scanning body text (which now includes captions). We check dialogs,
   * alert roles, and headings, but deliberately skip any element that
   * looks like a caption/transcript region.
   */
  private async hasKickedSignal() {
    return this.getPage()
      .evaluate(() => {
        const CAPTION_HINTS = ["caption", "transcript", "live transcript"];
        const isCaptionNode = (el: Element | null): boolean => {
          let cursor: Element | null = el;
          while (cursor) {
            const label = (cursor.getAttribute("aria-label") ?? "").toLowerCase();
            const role = (cursor.getAttribute("role") ?? "").toLowerCase();
            const dataset = (cursor.getAttribute("data-allocation-index") ?? "")
              .toLowerCase();
            if (CAPTION_HINTS.some((hint) => label.includes(hint))) return true;
            if (role === "region" && label.includes("caption")) return true;
            if (dataset) return true;
            cursor = cursor.parentElement;
          }
          return false;
        };

        const candidates = Array.from(
          document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [role="alert"], h1, h2, [role="heading"]'
          )
        );

        for (const node of candidates) {
          if (isCaptionNode(node)) continue;
          const text = (node.textContent ?? "").trim();
          if (!text) continue;
          if (/you(?:'ve| have) been removed|removed from the (meeting|call)/i.test(text)) {
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
  }

  /**
   * Detect the post-call screen — Meet shows either a "Return to home
   * screen" / "Rejoin" button, or a heading saying the meeting has ended.
   */
  private async hasRoomEndedSignal() {
    return this.getPage()
      .evaluate(() => {
        const CAPTION_HINTS = ["caption", "transcript", "live transcript"];
        const isCaptionNode = (el: Element | null): boolean => {
          let cursor: Element | null = el;
          while (cursor) {
            const label = (cursor.getAttribute("aria-label") ?? "").toLowerCase();
            if (CAPTION_HINTS.some((hint) => label.includes(hint))) return true;
            cursor = cursor.parentElement;
          }
          return false;
        };

        // The post-call screen reliably shows a "Return to home screen"
        // or "Rejoin" button. Neither appears while you're in a call.
        const buttons = Array.from(document.querySelectorAll("button, a"));
        for (const button of buttons) {
          if (isCaptionNode(button)) continue;
          const text = (button.textContent ?? "").trim().toLowerCase();
          const label = (button.getAttribute("aria-label") ?? "").trim().toLowerCase();
          if (/return to home screen|rejoin/.test(text)) return true;
          if (/return to home screen|rejoin/.test(label)) return true;
        }

        // Fallback: end-of-meeting heading in a non-caption region.
        const headings = Array.from(
          document.querySelectorAll('h1, h2, [role="heading"]')
        );
        for (const heading of headings) {
          if (isCaptionNode(heading)) continue;
          const text = (heading.textContent ?? "").trim();
          if (/meeting (has )?ended|you left the (meeting|call)/i.test(text)) {
            return true;
          }
        }

        return false;
      })
      .catch(() => false);
  }

  /**
   * Fallback solo detection when the participant count can't be read.
   * Scopes to Meet's own "you're the only one here" notice instead of
   * body text so captions don't trigger a false solo exit.
   */
  private async hasSoloSignal() {
    return this.getPage()
      .evaluate(() => {
        const CAPTION_HINTS = ["caption", "transcript", "live transcript"];
        const isCaptionNode = (el: Element | null): boolean => {
          let cursor: Element | null = el;
          while (cursor) {
            const label = (cursor.getAttribute("aria-label") ?? "").toLowerCase();
            if (CAPTION_HINTS.some((hint) => label.includes(hint))) return true;
            cursor = cursor.parentElement;
          }
          return false;
        };

        const candidates = Array.from(
          document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [role="status"], [role="heading"], h1, h2, h3'
          )
        );
        for (const node of candidates) {
          if (isCaptionNode(node)) continue;
          const text = (node.textContent ?? "").trim();
          if (!text) continue;
          if (
            /only one here|no one else is here|you'?re the only one here|you are the only one here/i.test(
              text
            )
          ) {
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
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
