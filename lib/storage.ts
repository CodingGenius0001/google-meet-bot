import { put } from "@vercel/blob";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

function inferContentType(fileName: string) {
  if (fileName.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (fileName.endsWith(".webm")) {
    return "video/webm";
  }

  return "application/octet-stream";
}

export async function uploadRecordingArtifact(jobId: string, filePath: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return null;
  }

  const buffer = await readFile(filePath);
  const fileName = basename(filePath);
  const key = `meetings/${jobId}/${fileName}`;
  const blob = await put(key, buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: inferContentType(fileName),
    token
  });

  return {
    key,
    url: blob.url
  };
}
