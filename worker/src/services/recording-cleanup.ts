import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { logger } from "../utils/logger";

export const RECORDING_OUTPUT_DIR = path.resolve(process.cwd(), "worker", "output");

const ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Delete a recording file from disk. Safe to call with a path that no longer
 * exists. Refuses to delete anything outside the recording output directory.
 */
export async function deleteRecordingFile(filePath: string): Promise<void> {
  if (!filePath) {
    return;
  }

  const resolved = path.resolve(filePath);
  const root = path.resolve(RECORDING_OUTPUT_DIR);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    logger.warn("Refusing to delete file outside recording output directory.", {
      filePath: resolved
    });
    return;
  }

  try {
    await unlink(resolved);
    logger.info("Deleted recording file.", { filePath: resolved });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    logger.warn("Failed to delete recording file.", { filePath: resolved, error });
  }
}

/**
 * On worker startup, sweep any recording files that are older than ORPHAN_AGE_MS.
 * These can only exist if a previous worker crashed mid-job.
 */
export async function sweepOrphanRecordings(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(RECORDING_OUTPUT_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    const entryPath = path.join(RECORDING_OUTPUT_DIR, entry);
    try {
      const info = await stat(entryPath);
      if (!info.isFile()) {
        continue;
      }
      if (now - info.mtimeMs < ORPHAN_AGE_MS) {
        continue;
      }
      await deleteRecordingFile(entryPath);
      removed += 1;
    } catch (error) {
      logger.warn("Failed to inspect recording during sweep.", { entryPath, error });
    }
  }

  if (removed > 0) {
    logger.info("Orphan recording sweep removed files.", { removed });
  }
}
