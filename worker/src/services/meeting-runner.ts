import { MeetingEndReason, MeetingStatus, Prisma, type MeetingJob } from "@prisma/client";

import { summarizeTranscript } from "../../../lib/ai";
import { prisma } from "../../../lib/prisma";
import { uploadRecordingArtifact } from "../../../lib/storage";
import { CancelledError, GoogleMeetBot } from "../bot/google-meet-bot";
import { transcribeRecording } from "./recording-transcription";
import { deleteRecordingFile } from "./recording-cleanup";
import { logger } from "../utils/logger";

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_FAILURE_THRESHOLD = 4;

// Statuses that mean the job has reached a terminal state. Workers must never
// overwrite these so a crash recovery can leave failed jobs visible.
const TERMINAL_STATUSES: MeetingStatus[] = [
  MeetingStatus.COMPLETED,
  MeetingStatus.FAILED,
  MeetingStatus.KICKED,
  MeetingStatus.ENDED_EMPTY,
  MeetingStatus.ENDED_ROOM_CLOSED
];

// Statuses we expect to see while a worker is actively processing the job.
const ACTIVE_STATUSES: MeetingStatus[] = [
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
];

function normalizeTranscriptText(raw: string | null) {
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

/**
 * Update a job only if it's still in an active (non-terminal) state and still
 * owned by this worker. Returns true if the row was actually updated.
 */
async function updateActiveJob(
  jobId: string,
  workerId: string,
  data: Prisma.MeetingJobUncheckedUpdateManyInput
): Promise<boolean> {
  const result = await prisma.meetingJob.updateMany({
    where: {
      id: jobId,
      workerId,
      status: { in: ACTIVE_STATUSES }
    },
    data
  });
  return result.count > 0;
}

/**
 * Write the final state for a job. Refuses to overwrite a row that has already
 * reached a terminal status (e.g. another worker recovered the job).
 */
async function finalizeJob(
  jobId: string,
  workerId: string,
  data: Prisma.MeetingJobUncheckedUpdateManyInput
): Promise<boolean> {
  const result = await prisma.meetingJob.updateMany({
    where: {
      id: jobId,
      workerId,
      status: { notIn: TERMINAL_STATUSES }
    },
    data
  });
  return result.count > 0;
}

export async function processMeetingJob(job: MeetingJob, workerId: string) {
  const bot = new GoogleMeetBot({
    jobId: job.id,
    meetUrl: job.meetUrl,
    onJoined: async ({ joinedAt, recordingPath }) => {
      // Flip the row from JOINING -> LIVE so the dashboard reflects the
      // actual state. Only succeeds while we still own the row and the
      // status is active, which keeps this safe against races with
      // recovery workers.
      const updated = await updateActiveJob(job.id, workerId, {
        status: MeetingStatus.LIVE,
        joinedAt,
        lastHeartbeatAt: new Date(),
        progressNote: recordingPath
          ? "In meeting — recording is running."
          : "In meeting — recording is disabled."
      });
      if (updated) {
        logger.info("Bot admitted to meeting — flipped to LIVE.", {
          jobId: job.id,
          recording: Boolean(recordingPath)
        });
      } else {
        logger.warn("Could not flip job to LIVE — row is no longer ours.", {
          jobId: job.id
        });
      }
    }
  });

  // Fire-and-forget helper to publish a short stage note without blocking
  // the main flow. Failures are swallowed because a progress-note write
  // must never break the pipeline.
  const setProgressNote = async (note: string) => {
    try {
      await updateActiveJob(job.id, workerId, {
        progressNote: note,
        lastHeartbeatAt: new Date()
      });
    } catch (error) {
      logger.warn("Failed to update progress note.", {
        jobId: job.id,
        note,
        error
      });
    }
  };
  let botCleanedUp = false;
  let recordingPathToDelete: string | null = null;
  let consecutiveHeartbeatFailures = 0;
  let heartbeatAborted = false;

  const heartbeat = setInterval(async () => {
    try {
      const updated = await updateActiveJob(job.id, workerId, {
        lastHeartbeatAt: new Date()
      });

      if (!updated) {
        // Either the job was reassigned or it has already terminated. Either
        // way the worker has lost ownership and should stop pretending it owns
        // the row.
        if (!heartbeatAborted) {
          heartbeatAborted = true;
          logger.warn("Heartbeat could not update the job — worker has lost ownership.", {
            jobId: job.id,
            workerId
          });
        }
        return;
      }

      consecutiveHeartbeatFailures = 0;

      // Poll the cancel flag on every heartbeat. Cheap: we already read the
      // row to write lastHeartbeatAt, but updateMany doesn't return the row,
      // so do a tiny select for the one column we care about. No-op once
      // the bot has already been told to stop.
      if (!bot.hasCancelRequest()) {
        const snapshot = await prisma.meetingJob.findUnique({
          where: { id: job.id },
          select: { cancelRequestedAt: true }
        });
        if (snapshot?.cancelRequestedAt) {
          logger.info("Dashboard requested stop — forwarding to bot.", {
            jobId: job.id
          });
          bot.requestCancel();
        }
      }
    } catch (error) {
      consecutiveHeartbeatFailures += 1;
      logger.warn("Failed to send worker heartbeat.", {
        jobId: job.id,
        attempt: consecutiveHeartbeatFailures,
        error
      });

      if (consecutiveHeartbeatFailures >= HEARTBEAT_FAILURE_THRESHOLD && !heartbeatAborted) {
        heartbeatAborted = true;
        logger.error(
          "Heartbeat has failed repeatedly — worker may be disconnected from the database.",
          { jobId: job.id, attempts: consecutiveHeartbeatFailures }
        );
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Make sure interval errors never become unhandled rejections.
  if (typeof (heartbeat as { unref?: () => void }).unref === "function") {
    (heartbeat as { unref: () => void }).unref();
  }

  try {
    await updateActiveJob(job.id, workerId, {
      status: MeetingStatus.JOINING,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      errorMessage: null,
      progressNote: "Starting browser and joining the meeting..."
    });

    const result = await bot.run();
    await bot.cleanup();
    botCleanedUp = true;
    recordingPathToDelete = result.recordingPath;

    await updateActiveJob(job.id, workerId, {
      status: MeetingStatus.PROCESSING,
      lastHeartbeatAt: new Date(),
      progressNote: "Meeting ended. Processing recording..."
    });

    let recordingUrl: string | null = null;
    let recordingKey: string | null = null;
    let transcriptionFromRecording: string | null = null;
    let transcriptionErrored = false;
    let uploadErrored = false;

    if (result.recordingPath) {
      await setProgressNote("Transcribing audio (this can take a few minutes)...");
      try {
        transcriptionFromRecording = await transcribeRecording(result.recordingPath);
      } catch (error) {
        transcriptionErrored = true;
        logger.warn("Recording transcription failed.", error);
      }
    } else {
      await setProgressNote(
        "No recording was produced (recording is disabled on this worker)."
      );
    }

    if (result.recordingPath) {
      await setProgressNote("Uploading recording to cloud storage...");
      try {
        const recording = await uploadRecordingArtifact(job.id, result.recordingPath);
        recordingUrl = recording?.url ?? null;
        recordingKey = recording?.key ?? null;
        if (!recording) {
          // Silent skip — the env var isn't configured. Tell the user
          // exactly why their recording didn't show up.
          await setProgressNote(
            "Recording upload skipped — BLOB_READ_WRITE_TOKEN is not configured on the worker."
          );
        }
      } catch (error) {
        uploadErrored = true;
        logger.warn("Recording upload failed.", error);
        await setProgressNote(
          `Recording upload failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    let aiSummary: string | null = null;
    let summaryErrored = false;
    const transcriptText = normalizeTranscriptText(
      transcriptionFromRecording ?? result.transcriptText
    );

    if (transcriptText) {
      await setProgressNote("Generating meeting summary...");
      try {
        aiSummary = await summarizeTranscript(transcriptText);
      } catch (error) {
        summaryErrored = true;
        logger.warn("Automatic summary generation failed.", error);
      }
    }

    // Build a final progress note that reflects what actually worked so
    // the user has a clear post-mortem without having to dig through
    // Railway logs.
    const finalNoteParts: string[] = [];
    if (recordingUrl) finalNoteParts.push("recording uploaded");
    else if (result.recordingPath && !uploadErrored)
      finalNoteParts.push("recording NOT uploaded (missing BLOB_READ_WRITE_TOKEN)");
    else if (uploadErrored) finalNoteParts.push("recording upload failed");
    else finalNoteParts.push("no recording produced");

    if (transcriptText) finalNoteParts.push("transcript ready");
    else if (transcriptionErrored) finalNoteParts.push("transcription failed");
    else finalNoteParts.push("no transcript");

    if (aiSummary) finalNoteParts.push("summary generated");
    else if (summaryErrored) finalNoteParts.push("summary generation failed");
    else if (transcriptText) finalNoteParts.push("summary skipped");

    const finalNote = finalNoteParts.join(" · ");

    const finalized = await finalizeJob(job.id, workerId, {
      status: result.finalStatus,
      endReason: result.endReason,
      joinedAt: result.joinedAt,
      endedAt: result.endedAt,
      captionsEnabled: result.captionsEnabled,
      participantsPeak: result.participantsPeak,
      transcriptText,
      transcriptJson:
        result.transcriptSegments.length > 0
          ? (result.transcriptSegments as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      aiSummary,
      recordingUrl,
      recordingKey,
      lastHeartbeatAt: new Date(),
      progressNote: finalNote
    });

    if (!finalized) {
      logger.warn("Could not write final job state — job already terminal.", { jobId: job.id });
    }
  } catch (error) {
    // A cancellation thrown before the bot was admitted is a clean exit,
    // not a failure. Mark the job COMPLETED with the CANCELLED end reason
    // instead of FAILED so the dashboard doesn't show a scary error.
    if (error instanceof CancelledError) {
      logger.info("Meeting job cancelled before join.", { jobId: job.id });
      await finalizeJob(job.id, workerId, {
        status: MeetingStatus.COMPLETED,
        endReason: MeetingEndReason.CANCELLED,
        endedAt: new Date(),
        lastHeartbeatAt: new Date()
      }).catch((finalizeError) => {
        logger.error("Failed to mark job as cancelled.", {
          jobId: job.id,
          finalizeError
        });
      });
    } else {
      const message = error instanceof Error ? error.message : "Unknown worker failure.";
      const endReason = message.includes("Timed out")
        ? MeetingEndReason.JOIN_TIMEOUT
        : message.includes("not allowed")
          ? MeetingEndReason.HOST_NEVER_ADMITTED
          : MeetingEndReason.UNKNOWN;

      await finalizeJob(job.id, workerId, {
        status: MeetingStatus.FAILED,
        endReason,
        errorMessage: message.slice(0, 1024),
        endedAt: new Date(),
        lastHeartbeatAt: new Date()
      }).catch((finalizeError) => {
        logger.error("Failed to mark job as failed.", { jobId: job.id, finalizeError });
      });

      logger.error("Meeting job failed.", { jobId: job.id, message });
    }
  } finally {
    clearInterval(heartbeat);

    if (!botCleanedUp) {
      await bot.cleanup().catch((cleanupError) => {
        logger.warn("Bot cleanup failed.", cleanupError);
      });
    }

    if (recordingPathToDelete) {
      await deleteRecordingFile(recordingPathToDelete);
    }
  }
}
