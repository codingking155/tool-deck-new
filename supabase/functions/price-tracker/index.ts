// Price Tracker lookup: paste an Amazon product link → live price + real history.
//
// POST { url }  →  200 { product }            (product.observations = real readings only)
//                  4xx/5xx { error: { code, message } }
//
// Provider keys (PA-API / Keepa) are server-side secrets; see docs/PRICE_TRACKER.md.
import { preflight, json, fail, log } from "../_shared/http.ts";
import { serviceClient, env } from "../_shared/supabase.ts";
import { rateLimit, clientIp } from "../_shared/ratelimit.ts";
import { supabaseRepo } from "../_shared/priceRepo.ts";
import { providerConfig } from "../../../shared/priceTrackerCore/provider.mjs";
import { lookupProduct, presentProduct, defaultIntervals, UNAVAILABLE_MESSAGE } from "../../../shared/priceTrackerCore/tracker.mjs";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");

  const rl = rateLimit(`price-lookup:${clientIp(req)}`, Number(env("PRICE_LOOKUP_RATE_LIMIT_MAX", "30")), 60_000);
  if (!rl.ok) return fail(429, "rate_limited", "Too many lookups. Please wait a minute and try again.");

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim().slice(0, 2048) : "";
  if (!url) return fail(400, "bad_request", "Paste an Amazon product link.");

  try {
    const cfg = providerConfig((k: string) => Deno.env.get(k) ?? "");
    const intervals = defaultIntervals((k: string) => Deno.env.get(k) ?? "");
    const repo = supabaseRepo(serviceClient());
    const res = await lookupProduct(url, { repo, cfg, intervals, fetchImpl: fetch });
    if (!res.ok) {
      log("price_lookup_failed", { code: res.code, detail: res.detail });
      return fail(res.status, res.code, res.message);
    }
    return json({ product: presentProduct(res.product, res.observations, { warning: res.warning }) });
  } catch (e) {
    log("price_lookup_error", { message: String((e as Error).message ?? e) });
    return fail(502, "price_unavailable", UNAVAILABLE_MESSAGE);
  }
});
