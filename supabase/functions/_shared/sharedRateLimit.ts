import { serviceClient } from "./supabase.ts";
import { rateLimit } from "./ratelimit.ts";

async function keyHash(raw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// Cross-instance limit backed by public.rate_limit_hit (see migrations). The raw
// client identifier is hashed before it is stored. If the database is unreachable
// we fall back to the per-instance limiter rather than blocking or opening up fully.
export async function sharedRateLimit(scope: string, id: string, max: number, windowSec: number):
  Promise<{ ok: boolean; retryAfter: number }> {
  const key = `${scope}:${await keyHash(id)}`;
  try {
    const { data, error } = await serviceClient().rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSec });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw new Error(error?.message ?? "no result");
    return { ok: !!row.allowed, retryAfter: Number(row.retry_after) || windowSec };
  } catch {
    const r = rateLimit(key, max, windowSec * 1000);
    return { ok: r.ok, retryAfter: ("retryAfter" in r ? r.retryAfter : undefined) ?? windowSec };
  }
}
