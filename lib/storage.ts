import { put } from "@vercel/blob";
import { basename } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { withRetry } from "./retry";

const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_RECORDING_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB

function inferContentType(fileName: string) {
  if (fileName.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (fileName.endsWith(".webm")) {
    return "video/webm";
  }

  return "application/octet-stream";
}

function sanitizeFileName(filePath: string) {
  const name = basename(filePath);

  // Reject anything that isn't a plain file name. basename() already strips
  // directory components, but this is a defensive second barrier.
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`Refusing to upload recording with unsafe file name: ${filePath}`);
  }

  if (!SAFE_FILE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Recording file name contains unsupported characters: ${name}. Only alphanumerics, dot, underscore and hyphen are allowed.`
    );
  }

  return name;
}

function sanitizeJobId(jobId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
    throw new Error(`Refusing to upload recording with unsafe jobId: ${jobId}`);
  }
  return jobId;
}

// Exported for unit tests.
export const __testing = { sanitizeFileName, sanitizeJobId, MAX_RECORDING_BYTES };

export async function uploadRecordingArtifact(jobId: string, filePath: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return null;
  }

  const safeJobId = sanitizeJobId(jobId);
  const fileName = sanitizeFileName(filePath);

  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`Recording path is not a file: ${filePath}`);
  }
  if (info.size === 0) {
    throw new Error(`Recording file is empty: ${filePath}`);
  }
  if (info.size > MAX_RECORDING_BYTES) {
    throw new Error(
      `Recording file is too large to upload (${info.size} bytes, max ${MAX_RECORDING_BYTES}).`
    );
  }

  const key = `meetings/${safeJobId}/${fileName}`;

  // Stream the file so we don't buffer multi-GB recordings into memory.
  const blob = await withRetry(
    async () =>
      put(key, createReadStream(filePath), {
        access: "public",
        addRandomSuffix: false,
        contentType: inferContentType(fileName),
        token
      }),
    {
      label: "vercel blob upload",
      attempts: 4
    }
  );

  return {
    key,
    url: blob.url
  };
}
