// Best-effort per-key rate limit (per warm instance). For strict, cross-instance
// limits put a counter in Postgres/Redis; documented as a beta limitation.
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max = Number(Deno.env.get("ALERT_RATE_LIMIT_MAX") ?? 20),
                          windowMs = Number(Deno.env.get("ALERT_RATE_LIMIT_WINDOW_MS") ?? 60_000)) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  if (b.count >= max) return { ok: false, remaining: 0, retryAfter: Math.ceil((b.reset - now) / 1000) };
  b.count++;
  return { ok: true, remaining: max - b.count };
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
