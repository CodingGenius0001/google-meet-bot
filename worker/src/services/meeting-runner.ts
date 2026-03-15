import { MeetingEndReason, MeetingStatus, Prisma, type MeetingJob } from "@prisma/client";

import { summarizeTranscript } from "../../../lib/ai";
import { prisma } from "../../../lib/prisma";
import { uploadRecordingArtifact } from "../../../lib/storage";
import { GoogleMeetBot } from "../bot/google-meet-bot";
import { transcribeRecording } from "./recording-transcription";
import { logger } from "../utils/logger";

function normalizeTranscriptText(raw: string | null) {
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

export async function processMeetingJob(job: MeetingJob, workerId: string) {
  const bot = new GoogleMeetBot({
    jobId: job.id,
    meetUrl: job.meetUrl
  });

  const heartbeat = setInterval(() => {
    prisma.meetingJob
      .update({
        where: { id: job.id },
        data: { lastHeartbeatAt: new Date(), workerId }
      })
      .catch((error: unknown) => {
        logger.warn("Failed to send worker heartbeat.", error);
      });
  }, 15000);

  try {
    await prisma.meetingJob.update({
      where: { id: job.id },
      data: {
        status: MeetingStatus.JOINING,
        workerId,
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        errorMessage: null
      }
    });

    const result = await bot.run();

    await prisma.meetingJob.update({
      where: { id: job.id },
      data: {
        status: MeetingStatus.PROCESSING,
        lastHeartbeatAt: new Date()
      }
    });

    let recordingUrl: string | null = null;
    let recordingKey: string | null = null;
    let transcriptionFromRecording: string | null = null;

    if (result.recordingPath) {
      transcriptionFromRecording = await transcribeRecording(result.recordingPath);
    }

    if (result.recordingPath) {
      try {
        const recording = await uploadRecordingArtifact(job.id, result.recordingPath);
        recordingUrl = recording?.url ?? null;
        recordingKey = recording?.key ?? null;
      } catch (error) {
        logger.warn("Recording upload failed.", error);
      }
    }

    let aiSummary: string | null = null;
    const transcriptText = normalizeTranscriptText(
      transcriptionFromRecording ?? result.transcriptText
    );

    if (transcriptText) {
      try {
        aiSummary = await summarizeTranscript(transcriptText);
      } catch (error) {
        logger.warn("AI summary generation failed.", error);
      }
    }

    await prisma.meetingJob.update({
      where: { id: job.id },
      data: {
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
        lastHeartbeatAt: new Date()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker failure.";
    const endReason =
      message.includes("Timed out")
        ? MeetingEndReason.JOIN_TIMEOUT
        : message.includes("not allowed")
          ? MeetingEndReason.HOST_NEVER_ADMITTED
          : MeetingEndReason.UNKNOWN;

    await prisma.meetingJob.update({
      where: { id: job.id },
      data: {
        status: MeetingStatus.FAILED,
        endReason,
        errorMessage: message,
        endedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });

    logger.error("Meeting job failed.", { jobId: job.id, message });
  } finally {
    clearInterval(heartbeat);
    await bot.cleanup();
  }
}
