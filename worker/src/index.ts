import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { MeetingStatus, type MeetingJob } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { processMeetingJob } from "./services/meeting-runner";
import { logger } from "./utils/logger";

const WORKER_ID = process.env.WORKER_ID ?? `meet-worker-${randomUUID()}`;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const WORKER_PORT = Number(process.env.WORKER_PORT ?? 0);

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
  const healthServer = startHealthServer();
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

  await new Promise<void>((resolve) => {
    healthServer?.close(() => resolve());

    if (!healthServer) {
      resolve();
    }
  });
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

function startHealthServer() {
  if (!WORKER_PORT) {
    return null;
  }

  const server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "worker",
        workerId: WORKER_ID,
        shuttingDown,
        timestamp: new Date().toISOString()
      })
    );
  });

  server.listen(WORKER_PORT, () => {
    logger.info("Worker health server listening.", { port: WORKER_PORT });
  });

  return server;
}
