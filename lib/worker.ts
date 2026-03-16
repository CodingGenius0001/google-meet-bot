type SummonWorkerResult = {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
};

function resolveSummonUrl() {
  const configured = process.env.WORKER_SUMMON_URL?.trim();

  if (!configured) {
    return null;
  }

  return new URL(configured.endsWith("/summon") ? configured : "/summon", configured).toString();
}

export async function summonWorker(): Promise<SummonWorkerResult> {
  const summonUrl = resolveSummonUrl();

  if (!summonUrl) {
    return {
      attempted: false,
      ok: false,
      error: "WORKER_SUMMON_URL is not configured."
    };
  }

  const token = process.env.WORKER_SUMMON_TOKEN?.trim();

  try {
    const response = await fetch(summonUrl, {
      method: "POST",
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        status: response.status,
        error: `Worker summon failed with status ${response.status}.`
      };
    }

    return {
      attempted: true,
      ok: true,
      status: response.status
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : "Worker summon failed."
    };
  }
}
