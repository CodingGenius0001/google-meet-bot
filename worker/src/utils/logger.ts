function formatMessage(level: string, message: string, context?: unknown) {
  const prefix = `[${new Date().toISOString()}] [${level}] ${message}`;

  if (context === undefined) {
    return prefix;
  }

  return `${prefix} ${JSON.stringify(context)}`;
}

export const logger = {
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

