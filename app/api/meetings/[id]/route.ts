import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/auth-server";
import { getMeetingJob } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    id: string;
  }>;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

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
