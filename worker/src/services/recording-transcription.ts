import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { logger } from "../utils/logger";

const TRANSCRIPTION_SEGMENT_SECONDS = Number(process.env.TRANSCRIPTION_SEGMENT_SECONDS ?? 900);

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

async function transcribeAudioChunk(chunkPath: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";
  const language = process.env.OPENAI_TRANSCRIPTION_LANGUAGE?.trim();
  const fileBuffer = await readFile(chunkPath);
  const form = new FormData();

  form.set("file", new Blob([fileBuffer], { type: "audio/mpeg" }), path.basename(chunkPath));
  form.set("model", model);
  form.set("response_format", "text");

  if (language) {
    form.set("language", language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI transcription request failed: ${response.status} ${errorText}`
    );
  }

  const text = (await response.text()).trim();
  return text || null;
}

export async function transcribeRecording(recordingPath: string) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  let artifacts:
    | {
        directory: string;
        chunkPaths: string[];
      }
    | null = null;

  try {
    logger.info("Preparing recording for transcription.", { recordingPath });
    artifacts = await buildAudioChunks(recordingPath);

    if (!artifacts.chunkPaths.length) {
      logger.warn("No audio chunks were produced for transcription.", { recordingPath });
      return null;
    }

    const transcriptParts: string[] = [];

    for (const chunkPath of artifacts.chunkPaths) {
      logger.info("Transcribing audio chunk.", { chunkPath });
      const text = await transcribeAudioChunk(chunkPath);

      if (text) {
        transcriptParts.push(text);
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
