type SummonWorkerResult = {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
};

const DEFAULT_SUMMON_TIMEOUT_MS = 15_000;

function resolveSummonTimeoutMs() {
  const configured = Number(process.env.WORKER_SUMMON_TIMEOUT_MS ?? "");

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_SUMMON_TIMEOUT_MS;
  }

  return Math.floor(configured);
}

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
  const timeoutMs = resolveSummonTimeoutMs();

  try {
    const response = await fetch(summonUrl, {
      method: "POST",
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
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
