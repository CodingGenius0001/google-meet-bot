import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/auth-server";
import { findActiveMeetingByCode } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { ensureString, normalizeMeetUrl } from "@/lib/validators";
import { summonWorker } from "@/lib/worker";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: NO_STORE_HEADERS }
  );
}

export async function GET() {
  const session = await getDashboardSession();
  if (!session) {
    return unauthorized();
  }

  const meetings = await prisma.meetingJob.findMany({
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  return NextResponse.json(meetings, { headers: NO_STORE_HEADERS });
}

/**
 * User-safe error messages. Anything that's a known validation error from
 * the validators or a known business-rule error gets passed through; anything
 * else is reported as a generic 500 with the real error logged server-side.
 */
function isClientError(message: string): boolean {
  return (
    /Meet URL/i.test(message) ||
    /Google Meet/i.test(message) ||
    /standard Google Meet room/i.test(message)
  );
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return unauthorized();
  }

  let payload: { title?: unknown; meetUrl?: unknown };
  try {
    payload = (await request.json()) as { title?: unknown; meetUrl?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  let meetUrl: string;
  let meetCode: string;
  let normalizedUrl: string;
  try {
    meetUrl = ensureString(payload.meetUrl, "Meet URL");
    const normalized = normalizeMeetUrl(meetUrl);
    meetCode = normalized.meetCode;
    normalizedUrl = normalized.meetUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const existing = await findActiveMeetingByCode(meetCode);
    if (existing) {
      return NextResponse.json(
        {
          error: "A bot is already active for that Meet room.",
          id: existing.id
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const title =
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 200)
        : null;

    const meeting = await prisma.meetingJob.create({
      data: {
        title,
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
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    // Log full details server-side, return a sanitized message to the client.
    console.error("Failed to create meeting job", error);
    const message = error instanceof Error ? error.message : "Unable to create the meeting job.";
    if (isClientError(message)) {
      return NextResponse.json(
        { error: message },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { error: "Unable to create the meeting job." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
