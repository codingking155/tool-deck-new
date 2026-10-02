// Best-effort per-key rate limit (per warm instance). For strict, cross-instance
// limits put a counter in Postgres/Redis; documented as a beta limitation.
const buckets = new Map<string, { count: number; reset: number }>();
const MAX_KEYS = 10_000;

function envNumber(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function rateLimit(key: string, max = envNumber("ALERT_RATE_LIMIT_MAX", 20),
                          windowMs = envNumber("ALERT_RATE_LIMIT_WINDOW_MS", 60_000)) {
  if (!Number.isFinite(max) || max <= 0) max = 20;
  if (!Number.isFinite(windowMs) || windowMs <= 0) windowMs = 60_000;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.delete(key);
    buckets.set(key, { count: 1, reset: now + windowMs });
    // Bound memory: drop expired buckets, then the oldest, once the map grows large.
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
      while (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value!);
    }
    return { ok: true, remaining: max - 1 };
  }
  if (b.count >= max) return { ok: false, remaining: 0, retryAfter: Math.ceil((b.reset - now) / 1000) };
  b.count++;
  return { ok: true, remaining: max - b.count };
}

// The client controls the left-most X-Forwarded-For entry, so keying a limit
// on it lets anyone dodge the limit by sending a fresh value per request.
// Prefer headers the edge proxy overwrites; fall back to the right-most
// X-Forwarded-For hop, which is the address the proxy itself saw.
export function clientIp(req: Request): string {
  const h = req.headers;
  const direct = (h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? "").trim();
  if (direct) return direct;
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] || "unknown";
}
