import { NextResponse } from "next/server";
import { MeetingStatus } from "@prisma/client";

import { getDashboardSession } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    id: string;
  }>;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// The worker only looks at cancelRequestedAt while it's actively handling a
// row. Sending a cancel to a terminal job would just be noise.
const CANCELLABLE_STATUSES: MeetingStatus[] = [
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
];

export async function POST(_request: Request, { params }: RouteProps) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await params;

  // Conditional update: only stamp cancelRequestedAt if the job is still in
  // a cancellable status AND has not already been cancelled. This keeps
  // repeated clicks idempotent and avoids overwriting a prior request time.
  const { count } = await prisma.meetingJob.updateMany({
    where: {
      id,
      status: { in: CANCELLABLE_STATUSES },
      cancelRequestedAt: null
    },
    data: {
      cancelRequestedAt: new Date()
    }
  });

  if (count === 0) {
    // Figure out why we didn't update so we can return a sensible error.
    const existing = await prisma.meetingJob.findUnique({
      where: { id },
      select: { status: true, cancelRequestedAt: true }
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Meeting not found." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    if (existing.cancelRequestedAt) {
      // Already pending cancel — treat as success so the UI settles.
      return NextResponse.json(
        { ok: true, alreadyRequested: true },
        { headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        error: `Session is no longer cancellable (status: ${existing.status}).`
      },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
