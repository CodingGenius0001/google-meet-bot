/**
 * Centralized environment variable validation.
 *
 * Import `requireWebEnv()` or `requireWorkerEnv()` at startup to fail fast
 * with a clear error message instead of crashing later at runtime.
 */

type EnvSpec = {
  key: string;
  required: boolean;
  validate?: (value: string) => string | null;
  description: string;
};

function validateDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
      return `must be a mysql:// URL (got ${url.protocol})`;
    }
    if (!url.hostname) {
      return "must include a hostname";
    }
    return null;
  } catch {
    return "must be a valid URL";
  }
}

function validateHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `must be an http:// or https:// URL (got ${url.protocol})`;
    }
    return null;
  } catch {
    return "must be a valid URL";
  }
}

function validatePositiveInt(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return "must be a non-negative integer";
  }
  return null;
}

const WEB_ENV: EnvSpec[] = [
  {
    key: "DATABASE_URL",
    required: true,
    validate: validateDatabaseUrl,
    description: "Prisma/TiDB MySQL connection string"
  },
  {
    key: "WORKER_SUMMON_URL",
    required: false,
    validate: validateHttpUrl,
    description: "Public worker URL used to wake serverless workers"
  },
  {
    key: "WORKER_SUMMON_TIMEOUT_MS",
    required: false,
    validate: validatePositiveInt,
    description: "Summon request timeout in milliseconds"
  },
  {
    key: "NEXTAUTH_SECRET",
    required: true,
    description: "Secret used to sign NextAuth session cookies"
  },
  {
    key: "GOOGLE_CLIENT_ID",
    required: true,
    description: "Google OAuth client ID"
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    required: true,
    description: "Google OAuth client secret"
  },
  {
    key: "DASHBOARD_ALLOWED_EMAILS",
    required: true,
    description: "Comma-separated list of Google emails allowed to sign in"
  }
];

const WORKER_ENV: EnvSpec[] = [
  {
    key: "DATABASE_URL",
    required: true,
    validate: validateDatabaseUrl,
    description: "Prisma/TiDB MySQL connection string"
  },
  {
    key: "WORKER_POLL_INTERVAL_MS",
    required: false,
    validate: validatePositiveInt,
    description: "How often the worker polls TiDB for queued jobs"
  },
  {
    key: "JOIN_TIMEOUT_MS",
    required: false,
    validate: validatePositiveInt,
    description: "Deadline for Meet admission before failing the job"
  },
  {
    key: "SOLO_GRACE_PERIOD_MS",
    required: false,
    validate: validatePositiveInt,
    description: "How long the bot stays alone before leaving"
  },
  {
    key: "MAX_RECORDING_DURATION_MS",
    required: false,
    validate: validatePositiveInt,
    description: "Hard cap on a single recording duration"
  }
];

function validateEnv(specs: EnvSpec[], context: string) {
  const errors: string[] = [];

  for (const spec of specs) {
    const raw = process.env[spec.key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (spec.required) {
        errors.push(`  - ${spec.key} is required (${spec.description})`);
      }
      continue;
    }

    if (spec.validate) {
      const problem = spec.validate(value);
      if (problem) {
        errors.push(`  - ${spec.key} ${problem}`);
      }
    }
  }

  if (errors.length > 0) {
    const header = `Invalid ${context} environment:\n`;
    throw new Error(header + errors.join("\n"));
  }
}

let webChecked = false;
let workerChecked = false;

export function requireWebEnv() {
  if (webChecked) return;
  validateEnv(WEB_ENV, "web");
  webChecked = true;
}

export function requireWorkerEnv() {
  if (workerChecked) return;
  validateEnv(WORKER_ENV, "worker");
  workerChecked = true;
}

/**
 * Dashboard auth allowlist. Comma-separated emails in DASHBOARD_ALLOWED_EMAILS.
 * Matched case-insensitively.
 */
export function getAllowedEmails(): ReadonlySet<string> {
  const raw = process.env.DASHBOARD_ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}
