import { randomUUID } from "node:crypto";

import { MeetingStatus, type MeetingJob } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { processMeetingJob } from "./services/meeting-runner";
import { logger } from "./utils/logger";

const WORKER_ID = process.env.WORKER_ID ?? `meet-worker-${randomUUID()}`;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

let shuttingDown = false;

async function claimNextJob(): Promise<MeetingJob | null> {
  const candidate = await prisma.meetingJob.findFirst({
    where: {
      status: MeetingStatus.QUEUED
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (!candidate) {
    return null;
  }

  const claim = await prisma.meetingJob.updateMany({
    where: {
      id: candidate.id,
      status: MeetingStatus.QUEUED
    },
    data: {
      status: MeetingStatus.CLAIMED,
      workerId: WORKER_ID,
      lastHeartbeatAt: new Date()
    }
  });

  if (claim.count === 0) {
    return null;
  }

  return prisma.meetingJob.findUnique({
    where: {
      id: candidate.id
    }
  });
}

async function sleep(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function main() {
  logger.info("Meet bot worker started.", { workerId: WORKER_ID });

  while (!shuttingDown) {
    const job = await claimNextJob();

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    logger.info("Claimed meeting job.", { jobId: job.id, meetUrl: job.meetUrl });
    await processMeetingJob(job, WORKER_ID);
  }

  await prisma.$disconnect();
}

function handleShutdown(signal: string) {
  logger.info("Shutdown signal received.", { signal });
  shuttingDown = true;
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

main().catch(async (error) => {
  logger.error("Worker crashed.", error);
  await prisma.$disconnect();
  process.exit(1);
});
