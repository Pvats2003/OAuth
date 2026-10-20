// Simple fixed-window limiter per IP. In-memory, so it is per server instance:
// good enough to stop accidental bursts, not a hard quota.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;

export function rateLimit(ip: string): { ok: boolean; retryAfterMin: number } {
  const limit = Number(process.env.GENERATE_LIMIT_PER_HOUR || 10);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return { ok: false, retryAfterMin: Math.ceil((WINDOW_MS - (now - recent[0])) / 60000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { ok: true, retryAfterMin: 0 };
}
