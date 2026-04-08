import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const HEALTH_DB_TIMEOUT_MS = 3000;

async function checkDatabase(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB health check timed out")), HEALTH_DB_TIMEOUT_MS)
      )
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const dbOk = await checkDatabase();

  return NextResponse.json(
    {
      ok: dbOk,
      service: "web",
      db: dbOk ? "ok" : "unreachable",
      timestamp: new Date().toISOString()
    },
    {
      status: dbOk ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
