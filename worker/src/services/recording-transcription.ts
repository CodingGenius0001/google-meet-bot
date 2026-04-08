import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { withRetry } from "../../../lib/retry";
import { logger } from "../utils/logger";

const TRANSCRIPTION_SEGMENT_SECONDS = Number(process.env.TRANSCRIPTION_SEGMENT_SECONDS ?? 900);
// Match the location the Dockerfile copies whisper-cli to.
const DEFAULT_WHISPER_BINARY = "/opt/whisper.cpp/bin/whisper-cli";
const DEFAULT_WHISPER_MODEL = "/opt/whisper.cpp/models/ggml-tiny.en.bin";

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

async function buildAudioChunks(recordingPath: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "meetmate-transcription-"));
  const outputPattern = path.join(directory, "chunk-%03d.wav");

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
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    String(TRANSCRIPTION_SEGMENT_SECONDS),
    outputPattern
  ]);

  const chunkPaths = (await readdir(directory))
    .filter((name) => name.endsWith(".wav"))
    .sort()
    .map((name) => path.join(directory, name));

  return {
    directory,
    chunkPaths
  };
}

async function transcribeAudioChunk(chunkPath: string) {
  const whisperBinary = process.env.WHISPER_CPP_BINARY ?? DEFAULT_WHISPER_BINARY;
  const whisperModel = process.env.WHISPER_MODEL_PATH ?? DEFAULT_WHISPER_MODEL;
  const whisperLanguage = process.env.WHISPER_LANGUAGE?.trim() || "en";
  const whisperThreads = process.env.WHISPER_THREADS?.trim() || "4";
  const outputBase = chunkPath.replace(/\.wav$/i, "");

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

export async function transcribeRecording(recordingPath: string) {
  const whisperBinary = process.env.WHISPER_CPP_BINARY ?? DEFAULT_WHISPER_BINARY;
  const whisperModel = process.env.WHISPER_MODEL_PATH ?? DEFAULT_WHISPER_MODEL;

  if (!(await fileExists(whisperBinary)) || !(await fileExists(whisperModel))) {
    logger.warn("Whisper.cpp is not available. Falling back to caption-only transcripts.", {
      whisperBinary,
      whisperModel
    });
    return null;
  }

  let artifacts:
    | {
        directory: string;
        chunkPaths: string[];
      }
    | null = null;

  try {
    logger.info("Preparing recording for local transcription.", { recordingPath });
    artifacts = await buildAudioChunks(recordingPath);

    if (!artifacts.chunkPaths.length) {
      logger.warn("No audio chunks were produced for transcription.", { recordingPath });
      return null;
    }

    const transcriptParts: string[] = [];

    for (const chunkPath of artifacts.chunkPaths) {
      logger.info("Transcribing audio chunk with whisper.cpp.", { chunkPath });
      try {
        const text = await withRetry(() => transcribeAudioChunk(chunkPath), {
          label: `whisper chunk ${path.basename(chunkPath)}`,
          attempts: 3,
          baseDelayMs: 1000
        });

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
    logger.warn("Local recording transcription failed.", error);
    return null;
  } finally {
    if (artifacts) {
      await rm(artifacts.directory, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }
}
