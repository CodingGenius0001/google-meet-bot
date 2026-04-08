/**
 * Exponential-backoff retry helper for transient I/O.
 *
 * Only retries errors the caller classifies as transient. By default every
 * error is retried, which is fine for network I/O but callers that know
 * some errors are permanent should pass an `isRetryable` predicate.
 */

export type RetryOptions = {
  /** Max total attempts including the first one. Default 4. */
  attempts?: number;
  /** Base delay in ms. Default 500. Actual delay uses jittered exponential backoff. */
  baseDelayMs?: number;
  /** Cap on delay between attempts. Default 5000. */
  maxDelayMs?: number;
  /** Human label used in thrown error messages. */
  label?: string;
  /** Optional predicate that returns false to stop retrying a given error. */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry with the failed attempt number and error. */
  onRetry?: (attempt: number, error: unknown) => void;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelay = Math.max(1, options.baseDelayMs ?? 500);
  const maxDelay = Math.max(baseDelay, options.maxDelayMs ?? 5000);
  const label = options.label ?? "operation";
  const isRetryable = options.isRetryable ?? (() => true);

  let lastError: unknown = new Error(`${label} failed with no attempts`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !isRetryable(error)) {
        break;
      }

      const exponential = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jitter = Math.random() * exponential * 0.25;
      const delay = Math.round(exponential + jitter);

      options.onRetry?.(attempt, error);
      await sleep(delay);
    }
  }

  throw lastError;
}
