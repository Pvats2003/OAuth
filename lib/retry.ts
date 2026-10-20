import { ProviderError } from "./finalize";
import type { AgentEvent } from "./stages";

// Shared rate-limit handling for the Gemini and Groq paths.
// Retry a 429 up to 3 times, waiting for the provider's suggested delay or 5s / 15s / 30s.
// A single wait over 60s (e.g. a daily quota) or more than 120s of waiting in total gives up,
// so a guide stays inside the route's 300s limit.

const BACKOFF_MS = [5000, 15000, 30000];
const MAX_RETRIES = 3;
const MAX_SINGLE_WAIT_MS = 60_000;
const MAX_TOTAL_WAIT_MS = 120_000;

/** A provider's 429. `retryable` is false when waiting can't help (e.g. one request is over the per-minute limit). */
export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    readonly retryDelayMs: number | null,
    readonly retryable = true,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RateLimitError";
  }
}

export type WaitBudget = { waitedMs: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `call`, waiting out rate limits. Yields a "wait" event before each pause so the
 * page can show "Waiting for rate limit…"; returns the call's result.
 */
export async function* withRateLimitRetry<T>(call: () => Promise<T>, budget: WaitBudget): AsyncGenerator<AgentEvent, T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof RateLimitError) || !err.retryable || attempt >= MAX_RETRIES) throw err;
      const waitMs = err.retryDelayMs ?? BACKOFF_MS[attempt];
      if (waitMs > MAX_SINGLE_WAIT_MS || budget.waitedMs + waitMs > MAX_TOTAL_WAIT_MS) throw err;
      yield { type: "wait", seconds: Math.ceil(waitMs / 1000), attempt: attempt + 1, of: MAX_RETRIES };
      await sleep(waitMs);
      budget.waitedMs += waitMs;
    }
  }
}
