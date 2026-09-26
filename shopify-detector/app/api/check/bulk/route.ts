import type { NextRequest } from "next/server";
import { clientIp, errorBody, json, preflight, rateLimited, rateLimitHeaders } from "@/lib/api";
import { runCheck } from "@/lib/check-service";
import { checkRateLimit } from "@/lib/ratelimit";

export const maxDuration = 60;

const MAX_URLS = 50;
const CONCURRENCY = 5;

export function OPTIONS() {
  return preflight();
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export async function POST(req: NextRequest) {
  let urls: unknown;
  try {
    urls = ((await req.json()) as { urls?: unknown })?.urls;
  } catch {
    return json({ error: "invalid_body", message: 'Send JSON like {"urls": ["example.com"]}' }, 400);
  }
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string")) {
    return json({ error: "invalid_body", message: '"urls" must be a non-empty array of strings.' }, 400);
  }
  if (urls.length > MAX_URLS) {
    return json({ error: "too_many_urls", message: `Send at most ${MAX_URLS} URLs per request.` }, 400);
  }

  // Each URL costs one request against the caller's limits.
  const limit = await checkRateLimit(clientIp(req), urls.length);
  if (!limit.success) return rateLimited(limit);

  const results = await mapPool(urls as string[], CONCURRENCY, async (url) => {
    try {
      return await runCheck(url);
    } catch (err) {
      return { input_url: url, ...errorBody(err).body };
    }
  });
  return json({ count: results.length, results }, 200, rateLimitHeaders(limit));
}
