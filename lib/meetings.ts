import { MeetingStatus, type MeetingJob } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const ACTIVE_STATUSES = [
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
];

export async function listMeetingJobs(limit = 20) {
  return prisma.meetingJob.findMany({
    orderBy: {
      createdAt: "desc"
    },
    take: limit
  });
}

export async function getMeetingJob(id: string) {
  return prisma.meetingJob.findUnique({
    where: {
      id
    }
  });
}

export async function findActiveMeetingByCode(meetCode: string) {
  return prisma.meetingJob.findFirst({
    where: {
      meetCode,
      status: {
        in: ACTIVE_STATUSES
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export function formatMeetingStatus(status: MeetingJob["status"]) {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}
