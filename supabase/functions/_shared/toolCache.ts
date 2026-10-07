import { serviceClient } from "./supabase.ts";

// Cross-instance response cache backed by public.tool_cache (see migrations).
// Fail-open: if the database is slow or unreachable, callers just do the live lookup.
const DB_MS = 800;

async function cacheKey(scope: string, raw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return `${scope}:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
}

function within<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cache timeout")), DB_MS))]);
}

export async function cacheGet<T = unknown>(scope: string, raw: string): Promise<T | null> {
  try {
    const { data, error } = await within(serviceClient().from("tool_cache")
      .select("body").eq("key", await cacheKey(scope, raw)).gt("expires_at", new Date().toISOString()).maybeSingle());
    return error || !data ? null : (data.body as T);
  } catch { return null; }
}

export async function cachePut(scope: string, raw: string, body: unknown, ttlSec: number): Promise<void> {
  try {
    await within(serviceClient().from("tool_cache").upsert({
      key: await cacheKey(scope, raw), body, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }));
  } catch { /* best effort */ }
}
