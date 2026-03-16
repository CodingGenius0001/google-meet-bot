import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

import { MeetingStatus, type MeetingJob } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { processMeetingJob } from "./services/meeting-runner";
import { logger } from "./utils/logger";

const WORKER_ID = process.env.WORKER_ID ?? `meet-worker-${randomUUID()}`;
const WORKER_PORT = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 0);
const SUMMON_TOKEN = process.env.WORKER_SUMMON_TOKEN?.trim() || null;
const WORKER_POLL_INTERVAL_MS = Math.max(0, Number(process.env.WORKER_POLL_INTERVAL_MS ?? 0) || 0);

let shuttingDown = false;
let queueDrainRequested = false;
let queueDrainPromise: Promise<void> | null = null;
let activeJobId: string | null = null;
let healthServer: Server | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let resolveShutdown: (() => void) | null = null;
const shutdownPromise = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

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

async function disconnectPrisma() {
  await prisma.$disconnect().catch((error: unknown) => {
    logger.warn("Failed to disconnect Prisma cleanly.", error);
  });
}

async function drainQueue(source: string) {
  logger.info("Worker queue drain started.", { source });

  while (!shuttingDown && queueDrainRequested) {
    queueDrainRequested = false;

    while (!shuttingDown) {
      const job = await claimNextJob();

      if (!job) {
        break;
      }

      activeJobId = job.id;
      logger.info("Claimed meeting job.", { jobId: job.id, meetUrl: job.meetUrl });

      try {
        await processMeetingJob(job, WORKER_ID);
      } finally {
        activeJobId = null;
      }
    }
  }

  logger.info("Worker queue drain finished.", { source });
}

function requestQueueDrain(source: string) {
  queueDrainRequested = true;

  if (queueDrainPromise) {
    return false;
  }

  queueDrainPromise = drainQueue(source)
    .catch((error: unknown) => {
      logger.error("Worker queue drain crashed.", error);
    })
    .finally(async () => {
      activeJobId = null;
      queueDrainPromise = null;
      await disconnectPrisma();
    });

  return true;
}

async function main() {
  healthServer = startHealthServer();
  startPoller();
  logger.info("Meet bot worker started.", {
    workerId: WORKER_ID,
    port: WORKER_PORT || null,
    pollIntervalMs: WORKER_POLL_INTERVAL_MS || null
  });

  await shutdownPromise;
  await disconnectPrisma();
}

function handleShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  logger.info("Shutdown signal received.", { signal });
  shuttingDown = true;
  void shutdownWorker();
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

main().catch(async (error) => {
  logger.error("Worker crashed.", error);
  await disconnectPrisma();
  process.exit(1);
});

function startHealthServer() {
  if (!WORKER_PORT) {
    return null;
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          service: "worker",
          workerId: WORKER_ID,
          shuttingDown,
          busy: Boolean(queueDrainPromise),
          activeJobId,
          pollIntervalMs: WORKER_POLL_INTERVAL_MS || null,
          timestamp: new Date().toISOString()
        })
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/summon") {
      if (!isSummonAuthorized(request.headers.authorization, request.headers["x-worker-summon-token"])) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }

      const started = requestQueueDrain("http");
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          workerId: WORKER_ID,
          accepted: true,
          started,
          busy: Boolean(queueDrainPromise),
          activeJobId
        })
      );
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });

  server.listen(WORKER_PORT, () => {
    logger.info("Worker health server listening.", { port: WORKER_PORT });
  });

  return server;
}

function startPoller() {
  if (!WORKER_POLL_INTERVAL_MS) {
    return;
  }

  logger.info("Worker poller enabled.", { intervalMs: WORKER_POLL_INTERVAL_MS });
  requestQueueDrain("startup");
  pollTimer = setInterval(() => {
    requestQueueDrain("poller");
  }, WORKER_POLL_INTERVAL_MS);
}

async function shutdownWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  const server = healthServer;
  healthServer = null;

  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  if (queueDrainPromise) {
    await queueDrainPromise.catch(() => {
      return;
    });
  }

  resolveShutdown?.();
  resolveShutdown = null;
}

function isSummonAuthorized(
  authorizationHeader: string | undefined,
  summonHeader: string | string[] | undefined
) {
  if (!SUMMON_TOKEN) {
    return true;
  }

  const bearerToken = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken =
    typeof summonHeader === "string" ? summonHeader.trim() : summonHeader?.[0]?.trim();
  const candidate = bearerToken || headerToken;

  if (!candidate) {
    return false;
  }

  const expected = Buffer.from(SUMMON_TOKEN);
  const received = Buffer.from(candidate);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
