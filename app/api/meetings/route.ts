import { NextResponse } from "next/server";

import { findActiveMeetingByCode } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { ensureString, normalizeMeetUrl } from "@/lib/validators";
import { summonWorker } from "@/lib/worker";

export async function GET() {
  const meetings = await prisma.meetingJob.findMany({
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  return NextResponse.json(meetings);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      title?: unknown;
      meetUrl?: unknown;
    };

    const meetUrl = ensureString(payload.meetUrl, "Meet URL");
    const { meetCode, meetUrl: normalizedUrl } = normalizeMeetUrl(meetUrl);
    const existing = await findActiveMeetingByCode(meetCode);

    if (existing) {
      return NextResponse.json(
        {
          error: "A bot is already active for that Meet room.",
          id: existing.id
        },
        { status: 409 }
      );
    }

    const meeting = await prisma.meetingJob.create({
      data: {
        title:
          typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : null,
        meetUrl: normalizedUrl,
        meetCode
      }
    });

    const summon = await summonWorker();

    return NextResponse.json(
      {
        id: meeting.id,
        workerTriggered: summon.attempted ? summon.ok : undefined,
        workerNotice: summon.attempted && !summon.ok ? summon.error : null
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create the meeting job."
      },
      { status: 400 }
    );
  }
}
