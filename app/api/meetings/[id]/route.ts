import { NextResponse } from "next/server";
import { MeetingStatus } from "@prisma/client";
import { del as deleteBlob } from "@vercel/blob";

import { getDashboardSession } from "@/lib/auth-server";
import { getMeetingJob } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    id: string;
  }>;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// Active statuses mean a worker is (or was very recently) operating on the
// row. Deleting it out from under a running worker would race its final
// write — we refuse and ask the user to cancel/wait first.
const ACTIVE_STATUSES = new Set<MeetingStatus>([
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
]);

export async function GET(_request: Request, { params }: RouteProps) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    return NextResponse.json(
      { error: "Meeting not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(meeting, { headers: NO_STORE_HEADERS });
}

export async function DELETE(_request: Request, { params }: RouteProps) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    return NextResponse.json(
      { error: "Meeting not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  if (ACTIVE_STATUSES.has(meeting.status)) {
    return NextResponse.json(
      {
        error:
          "Cannot delete a session while the worker is still handling it. Wait for it to finish or fail first."
      },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }

  // Best-effort: drop the recording from Vercel Blob so the storage bill
  // doesn't grow forever. Failure to delete the blob must not block the DB
  // row removal — we log and continue.
  if (meeting.recordingUrl) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) {
      try {
        await deleteBlob(meeting.recordingUrl, { token });
      } catch (error) {
        console.error(
          `[meetings] Failed to delete blob for session ${meeting.id}:`,
          error
        );
      }
    }
  }

  // deleteMany is idempotent: if two tabs both click delete, the loser gets
  // count === 0 instead of a P2025 throw.
  const { count } = await prisma.meetingJob.deleteMany({ where: { id } });

  if (count === 0) {
    return NextResponse.json(
      { error: "Session was already deleted." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
