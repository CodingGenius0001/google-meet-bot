import path from "node:path";

import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/auth-server";
import { getMeetingJob } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    id: string;
  }>;
};

function sanitizeFileName(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "meeting";
}

function buildBaseFileName(meeting: {
  id: string;
  title: string | null;
  meetCode: string;
}) {
  return sanitizeFileName(meeting.title?.trim() || meeting.meetCode || meeting.id);
}

function buildTranscriptText(meeting: {
  transcriptText: string | null;
  transcriptJson: unknown;
}) {
  if (meeting.transcriptText?.trim()) {
    return meeting.transcriptText.trim();
  }

  if (!Array.isArray(meeting.transcriptJson)) {
    return null;
  }

  const lines = meeting.transcriptJson
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return null;
      }

      const speaker = "speaker" in segment && typeof segment.speaker === "string" ? segment.speaker : "Unknown";
      const text = "text" in segment && typeof segment.text === "string" ? segment.text : "";
      const capturedAt =
        "capturedAt" in segment && typeof segment.capturedAt === "string" ? segment.capturedAt : "";

      if (!text.trim()) {
        return null;
      }

      return capturedAt ? `[${capturedAt}] ${speaker}: ${text}` : `${speaker}: ${text}`;
    })
    .filter((line): line is string => Boolean(line));

  return lines.length ? lines.join("\n") : null;
}

function buildAttachmentHeaders(fileName: string, contentType: string) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store"
  };
}

export async function GET(request: Request, { params }: RouteProps) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const baseFileName = buildBaseFileName(meeting);

  if (kind === "transcript") {
    const transcript = buildTranscriptText(meeting);

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is not available yet." }, { status: 404 });
    }

    return new NextResponse(transcript, {
      headers: buildAttachmentHeaders(`${baseFileName}-transcript.txt`, "text/plain; charset=utf-8")
    });
  }

  if (kind === "summary") {
    const summary = meeting.aiSummary?.trim();

    if (!summary) {
      return NextResponse.json({ error: "Summary is not available yet." }, { status: 404 });
    }

    return new NextResponse(summary, {
      headers: buildAttachmentHeaders(`${baseFileName}-summary.txt`, "text/plain; charset=utf-8")
    });
  }

  if (kind === "recording") {
    if (!meeting.recordingUrl) {
      return NextResponse.json({ error: "Recording is not available yet." }, { status: 404 });
    }

    const upstream = await fetch(meeting.recordingUrl);

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Unable to fetch the recording file." }, { status: 502 });
    }

    const upstreamType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const extension =
      path.extname(meeting.recordingKey ?? "") ||
      path.extname(new URL(meeting.recordingUrl).pathname) ||
      ".mp4";

    return new NextResponse(upstream.body, {
      headers: buildAttachmentHeaders(`${baseFileName}-recording${extension}`, upstreamType)
    });
  }

  return NextResponse.json(
    {
      error: "Unsupported download type. Use kind=transcript, kind=summary, or kind=recording."
    },
    { status: 400 }
  );
}
