import { NextResponse } from "next/server";

import { getMeetingJob } from "@/lib/meetings";

type RouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  return NextResponse.json(meeting);
}
