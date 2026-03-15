-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM (
  'QUEUED',
  'CLAIMED',
  'JOINING',
  'LIVE',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'KICKED',
  'ENDED_EMPTY',
  'ENDED_ROOM_CLOSED'
);

-- CreateEnum
CREATE TYPE "MeetingEndReason" AS ENUM (
  'HOST_NEVER_ADMITTED',
  'BOT_KICKED',
  'ROOM_ENDED',
  'LAST_PARTICIPANT_LEFT',
  'JOIN_TIMEOUT',
  'UNKNOWN'
);

-- CreateTable
CREATE TABLE "MeetingJob" (
  "id" TEXT NOT NULL,
  "title" TEXT,
  "meetUrl" TEXT NOT NULL,
  "meetCode" TEXT NOT NULL,
  "status" "MeetingStatus" NOT NULL DEFAULT 'QUEUED',
  "endReason" "MeetingEndReason",
  "workerId" TEXT,
  "errorMessage" TEXT,
  "joinedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "recordingUrl" TEXT,
  "recordingKey" TEXT,
  "transcriptText" TEXT,
  "transcriptJson" JSONB,
  "aiSummary" TEXT,
  "participantsPeak" INTEGER,
  "captionsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingJob_status_createdAt_idx" ON "MeetingJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingJob_meetCode_status_idx" ON "MeetingJob"("meetCode", "status");
