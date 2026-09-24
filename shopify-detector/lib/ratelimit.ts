import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./redis";

export const LIMIT_PER_MINUTE = 60;
export const LIMIT_PER_DAY = 1000;

export interface LimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch milliseconds when the window resets. */
  reset: number;
}

type Limiter = (id: string, cost: number) => Promise<LimitResult>;

function memoryLimiter(max: number, windowMs: number): Limiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (id, cost) => {
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }
    let w = windows.get(id);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(id, w);
    }
    if (w.count + cost > max) return { success: false, limit: max, remaining: Math.max(0, max - w.count), reset: w.resetAt };
    w.count += cost;
    return { success: true, limit: max, remaining: max - w.count, reset: w.resetAt };
  };
}

function upstashLimiter(rl: Ratelimit): Limiter {
  return async (id, cost) => {
    const r = await rl.limit(id, { rate: cost });
    return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
  };
}

let limiters: { minute: Limiter; day: Limiter } | undefined;

function getLimiters() {
  if (limiters) return limiters;
  const redis = getRedis();
  limiters = redis
    ? {
        minute: upstashLimiter(
          new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMIT_PER_MINUTE, "1 m"), prefix: "rl:min", ephemeralCache: new Map() }),
        ),
        day: upstashLimiter(new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(LIMIT_PER_DAY, "1 d"), prefix: "rl:day" })),
      }
    : {
        // Per-instance only; set the Upstash env vars for limits shared across serverless instances.
        minute: memoryLimiter(LIMIT_PER_MINUTE, 60_000),
        day: memoryLimiter(LIMIT_PER_DAY, 86_400_000),
      };
  return limiters;
}

/** Applies both windows; reports whichever one blocked, else the per-minute window. */
export async function checkRateLimit(id: string, cost = 1): Promise<LimitResult> {
  const { minute, day } = getLimiters();
  try {
    const m = await minute(id, cost);
    if (!m.success) return m;
    const d = await day(id, cost);
    return d.success ? m : d;
  } catch (err) {
    // Fail open: a Redis outage shouldn't take the API down with it.
    console.error("rate limit check failed", err);
    return { success: true, limit: LIMIT_PER_MINUTE, remaining: LIMIT_PER_MINUTE, reset: Date.now() + 60_000 };
  }
}
