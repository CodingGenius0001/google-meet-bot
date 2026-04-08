import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { withRetry } from "../../../lib/retry";
import { logger } from "../utils/logger";

// How long each audio chunk should be. Default 15 minutes. Keeps files well
// under the Groq/OpenAI 25 MB audio upload limit when combined with the
// mp3 compression step below.
const TRANSCRIPTION_SEGMENT_SECONDS = Number(process.env.TRANSCRIPTION_SEGMENT_SECONDS ?? 900);

// Optional local fallback. Matches the paths the old Dockerfile copied the
// whisper.cpp binary + model to. Kept as a fallback so anyone who has a
// whisper.cpp install baked into their image still gets local transcription.
const DEFAULT_WHISPER_BINARY = "/opt/whisper.cpp/bin/whisper-cli";
const DEFAULT_WHISPER_MODEL = "/opt/whisper.cpp/models/ggml-tiny.en.bin";

// Hosted whisper defaults. Groq hosts OpenAI-compatible audio transcription
// endpoints for whisper-large-v3 for free, so as long as the user has an
// LLM_API_KEY configured (which they already do for summaries) they get
// transcription too. They can override any of these via env.
const DEFAULT_HOSTED_WHISPER_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_HOSTED_WHISPER_MODEL = "whisper-large-v3-turbo";
const HOSTED_WHISPER_ALLOWED_HOSTS = new Set([
  "api.groq.com",
  "openrouter.ai",
  "api.together.xyz",
  "api.deepinfra.com",
  "api.openai.com"
]);
// Groq's free-tier audio limit is 25 MB. Reject uploads bigger than this
// rather than letting Groq 413 on us after a slow upload.
const HOSTED_WHISPER_MAX_BYTES = 24 * 1024 * 1024;

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

/**
 * Use ffmpeg to slice the recording into mp3 chunks. mp3 at 32 kbps mono is
 * intelligible for speech and keeps a 15-minute chunk at ~3.6 MB — comfortably
 * under Groq's 25 MB audio upload limit.
 */
async function buildAudioChunks(recordingPath: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "meetmate-transcription-"));
  const outputPattern = path.join(directory, "chunk-%03d.mp3");

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    recordingPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "32k",
    "-f",
    "segment",
    "-segment_time",
    String(TRANSCRIPTION_SEGMENT_SECONDS),
    outputPattern
  ]);

  const chunkPaths = (await readdir(directory))
    .filter((name) => name.endsWith(".mp3"))
    .sort()
    .map((name) => path.join(directory, name));

  return {
    directory,
    chunkPaths
  };
}

/**
 * Resolve the hosted whisper base URL with an SSRF allow-list, mirroring
 * the same check we do for the hosted LLM in lib/ai.ts. Only well-known
 * inference providers are allowed so a misconfiguration can't point this
 * at cloud metadata endpoints or internal services.
 */
function resolveHostedWhisperBaseUrl(): string {
  const raw = (
    process.env.HOSTED_WHISPER_BASE_URL ??
    process.env.LLM_BASE_URL ??
    DEFAULT_HOSTED_WHISPER_BASE_URL
  ).trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`HOSTED_WHISPER_BASE_URL is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `HOSTED_WHISPER_BASE_URL must be http:// or https://, got ${parsed.protocol}`
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const extraHosts = new Set(
    (process.env.HOSTED_WHISPER_ALLOWED_HOSTS ?? process.env.LLM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!HOSTED_WHISPER_ALLOWED_HOSTS.has(hostname) && !extraHosts.has(hostname)) {
    throw new Error(
      `HOSTED_WHISPER_BASE_URL ${hostname} is not a known provider. Add it to HOSTED_WHISPER_ALLOWED_HOSTS if you trust it.`
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

/**
 * Upload a single audio chunk to an OpenAI-compatible /audio/transcriptions
 * endpoint and return the transcript text. Uses `response_format=text` so
 * the response body is plain text (no JSON parsing needed).
 */
async function transcribeChunkHosted(
  chunkPath: string,
  opts: { baseUrl: string; apiKey: string; model: string }
): Promise<string | null> {
  const info = await stat(chunkPath);
  if (info.size === 0) {
    return null;
  }
  if (info.size > HOSTED_WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio chunk is ${info.size} bytes, exceeds hosted transcription limit of ${HOSTED_WHISPER_MAX_BYTES} bytes. ` +
        "Lower TRANSCRIPTION_SEGMENT_SECONDS."
    );
  }

  const buffer = await readFile(chunkPath);
  // Node 22 has native Blob/FormData/File — no form-data dep needed.
  const fileBlob = new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" });

  const form = new FormData();
  form.append("file", fileBlob, path.basename(chunkPath));
  form.append("model", opts.model);
  form.append("response_format", "text");
  const language = process.env.HOSTED_WHISPER_LANGUAGE?.trim();
  if (language) {
    form.append("language", language);
  }

  const endpoint = `${opts.baseUrl}/audio/transcriptions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const snippet = body.slice(0, 500);
    throw new Error(
      `Hosted whisper request failed: ${response.status} ${response.statusText}${
        snippet ? ` — ${snippet}` : ""
      }`
    );
  }

  const text = (await response.text()).trim();
  return text || null;
}

/**
 * Local whisper.cpp fallback. Preserved so anyone who bakes whisper.cpp
 * into their Docker image still gets transcription without needing a
 * hosted API key.
 */
async function transcribeChunkLocal(chunkPath: string) {
  const whisperBinary = process.env.WHISPER_CPP_BINARY ?? DEFAULT_WHISPER_BINARY;
  const whisperModel = process.env.WHISPER_MODEL_PATH ?? DEFAULT_WHISPER_MODEL;
  const whisperLanguage = process.env.WHISPER_LANGUAGE?.trim() || "en";
  const whisperThreads = process.env.WHISPER_THREADS?.trim() || "4";
  const outputBase = chunkPath.replace(/\.mp3$|\.wav$/i, "");

  await runCommand(whisperBinary, [
    "-m",
    whisperModel,
    "-f",
    chunkPath,
    "-l",
    whisperLanguage,
    "-t",
    whisperThreads,
    "--output-txt",
    "--output-file",
    outputBase
  ]);

  const text = (await readFile(`${outputBase}.txt`, "utf8")).trim();
  return text || null;
}

type TranscriptionBackend = "hosted" | "local";

function resolveBackend(): { backend: TranscriptionBackend; apiKey?: string } | null {
  const apiKey = (
    process.env.HOSTED_WHISPER_API_KEY ??
    process.env.LLM_API_KEY ??
    ""
  ).trim();

  if (apiKey) {
    return { backend: "hosted", apiKey };
  }

  // No hosted key — only use local whisper.cpp if the binary + model are both
  // actually present on disk.
  return { backend: "local" };
}

export async function transcribeRecording(recordingPath: string) {
  const backendChoice = resolveBackend();
  if (!backendChoice) {
    logger.warn(
      "No transcription backend configured. Set LLM_API_KEY (Groq) for hosted whisper, or install whisper.cpp locally."
    );
    return null;
  }

  if (backendChoice.backend === "local") {
    const whisperBinary = process.env.WHISPER_CPP_BINARY ?? DEFAULT_WHISPER_BINARY;
    const whisperModel = process.env.WHISPER_MODEL_PATH ?? DEFAULT_WHISPER_MODEL;

    if (!(await fileExists(whisperBinary)) || !(await fileExists(whisperModel))) {
      logger.warn(
        "No LLM_API_KEY is set and whisper.cpp is not installed. Set LLM_API_KEY to use Groq for free hosted transcription.",
        { whisperBinary, whisperModel }
      );
      return null;
    }
  }

  let hostedConfig: { baseUrl: string; apiKey: string; model: string } | null = null;
  if (backendChoice.backend === "hosted") {
    try {
      hostedConfig = {
        baseUrl: resolveHostedWhisperBaseUrl(),
        apiKey: backendChoice.apiKey!,
        model: process.env.HOSTED_WHISPER_MODEL?.trim() || DEFAULT_HOSTED_WHISPER_MODEL
      };
    } catch (error) {
      logger.warn("Hosted whisper misconfigured.", error);
      return null;
    }
  }

  let artifacts:
    | {
        directory: string;
        chunkPaths: string[];
      }
    | null = null;

  try {
    logger.info("Preparing recording for transcription.", {
      recordingPath,
      backend: backendChoice.backend
    });
    artifacts = await buildAudioChunks(recordingPath);

    if (!artifacts.chunkPaths.length) {
      logger.warn("No audio chunks were produced for transcription.", { recordingPath });
      return null;
    }

    const transcriptParts: string[] = [];

    for (const chunkPath of artifacts.chunkPaths) {
      logger.info("Transcribing audio chunk.", {
        chunkPath,
        backend: backendChoice.backend
      });
      try {
        const text = await withRetry(
          () =>
            backendChoice.backend === "hosted"
              ? transcribeChunkHosted(chunkPath, hostedConfig!)
              : transcribeChunkLocal(chunkPath),
          {
            label: `${backendChoice.backend} whisper chunk ${path.basename(chunkPath)}`,
            attempts: 3,
            baseDelayMs: 1000
          }
        );

        if (text) {
          transcriptParts.push(text);
        }
      } catch (error) {
        // Don't fail the whole transcription because one chunk is broken —
        // log it and move on so we still get a partial transcript.
        logger.warn("Skipping audio chunk after retries failed.", { chunkPath, error });
      }
    }

    const transcriptText = transcriptParts.join("\n\n").trim();
    return transcriptText || null;
  } catch (error) {
    logger.warn("Recording transcription failed.", error);
    return null;
  } finally {
    if (artifacts) {
      await rm(artifacts.directory, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }
}
