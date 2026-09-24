import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

/** Upstash client when both env vars are set, otherwise null (callers fall back to memory). */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}
