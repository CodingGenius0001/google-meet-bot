function serializeContext(context: unknown): string {
  if (context instanceof Error) {
    // JSON.stringify(new Error(...)) returns "{}" because name/message/stack
    // are non-enumerable. Pull them out explicitly so real errors actually
    // show up in the logs.
    return JSON.stringify({
      name: context.name,
      message: context.message,
      stack: context.stack,
      ...(context as unknown as Record<string, unknown>)
    });
  }

  if (context && typeof context === "object") {
    // Walk one level deep to unwrap any Error fields inside a context object
    // (e.g. logger.warn("...", { jobId, error })). Same problem as above.
    const unwrapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
      if (value instanceof Error) {
        unwrapped[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      } else {
        unwrapped[key] = value;
      }
    }
    return JSON.stringify(unwrapped);
  }

  return JSON.stringify(context);
}

function formatMessage(level: string, message: string, context?: unknown) {
  const prefix = `[${new Date().toISOString()}] [${level}] ${message}`;

  if (context === undefined) {
    return prefix;
  }

  return `${prefix} ${serializeContext(context)}`;
}

const DEBUG_ENABLED = process.env.WORKER_LOG_DEBUG === "true";

export const logger = {
  debug(message: string, context?: unknown) {
    if (!DEBUG_ENABLED) {
      return;
    }
    console.log(formatMessage("DEBUG", message, context));
  },
  info(message: string, context?: unknown) {
    console.log(formatMessage("INFO", message, context));
  },
  warn(message: string, context?: unknown) {
    console.warn(formatMessage("WARN", message, context));
  },
  error(message: string, context?: unknown) {
    console.error(formatMessage("ERROR", message, context));
  }
};

