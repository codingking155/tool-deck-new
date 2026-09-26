import { LRUCache } from "lru-cache";
import type { DetectionResult } from "./detect";
import { getRedis } from "./redis";

export const TTL_POSITIVE = 24 * 60 * 60;
export const TTL_NEGATIVE = 6 * 60 * 60;

const KEY = (host: string) => `check:v1:${host}`;

// Date as the clock keeps TTLs on wall time (and lets tests drive it with fake timers).
const memory = new LRUCache<string, DetectionResult>({ max: 5_000, ttlResolution: 0, perf: { now: () => Date.now() } });

export async function getCached(host: string): Promise<DetectionResult | null> {
  const redis = getRedis();
  if (!redis) return memory.get(KEY(host)) ?? null;
  try {
    return (await redis.get<DetectionResult>(KEY(host))) ?? null;
  } catch (err) {
    console.error("cache read failed", err);
    return null;
  }
}

export async function setCached(host: string, value: DetectionResult): Promise<void> {
  const ttl = value.is_shopify ? TTL_POSITIVE : TTL_NEGATIVE;
  const redis = getRedis();
  if (!redis) {
    memory.set(KEY(host), value, { ttl: ttl * 1000 });
    return;
  }
  try {
    await redis.set(KEY(host), value, { ex: ttl });
  } catch (err) {
    console.error("cache write failed", err);
  }
}
