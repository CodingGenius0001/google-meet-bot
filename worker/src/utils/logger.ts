function formatMessage(level: string, message: string, context?: unknown) {
  const prefix = `[${new Date().toISOString()}] [${level}] ${message}`;

  if (context === undefined) {
    return prefix;
  }

  return `${prefix} ${JSON.stringify(context)}`;
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

