import { preflight, json, fail, log } from "../_shared/http.ts";
import { analyzeShopify, applyHeaderSignals } from "../../../shared/shopifyCore/detect.mjs";

// GET /shopify-check?url=example.com
// Response shape is a superset of shopifyornot.in's /check API, so existing
// Zapier / n8n / Make recipes written for that shape work against this too:
//   is_shopify, confidence (0-1), input_url, final_url, shop_domain,
//   detected_signals, headers_sample, elapsed_ms
//   + extras: verdict, confidence_pct, theme, currency, plus, signals_detail

const HEADER_SAMPLE_KEYS = [
  "x-shopify-stage", "x-shopid", "x-sorting-hat-shopid", "x-sorting-hat-podid",
  "x-shardid", "powered-by", "server", "x-cache",
];

// Tiny per-instance cache: same URL within 10 min returns instantly.
const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 10 * 60 * 1000;

function isPrivateHost(host: string): boolean {
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return true;
  // numeric IPv4 in private/reserved ranges
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  }
  if (host.includes(":")) return true; // raw IPv6 literals: reject outright
  return false;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "GET") return fail(405, "method_not_allowed", "Use GET with ?url=");

  const raw = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!raw) return fail(400, "missing_url", "Pass ?url=example.com");

  let target: URL;
  try { target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return fail(400, "invalid_url", "That does not look like a valid URL."); }
  if (!/^https?:$/.test(target.protocol)) return fail(400, "invalid_url", "Only http(s) URLs are supported.");
  if (isPrivateHost(target.hostname)) return fail(400, "blocked_host", "Private and internal hosts cannot be checked.");

  const key = target.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return json(hit.body, 200, { "x-tooldeck-cache": "hit", "Cache-Control": "public, max-age=300" });
  }

  const t0 = performance.now();
  let html = "", finalUrl = target.href;
  const headers: Record<string, string> = {};
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const r = await fetch(target.href, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "ToolDeckBot/2.0 (+https://tooldeck.in/tool/shopify) shopify-check" },
    });
    clearTimeout(timer);
    finalUrl = r.url || finalUrl;
    for (const k of HEADER_SAMPLE_KEYS) { const v = r.headers.get(k); if (v != null) headers[k] = v; }
    // headers can decide on their own; body is capped so giant pages can't hurt us
    html = (await r.text()).slice(0, 1_500_000);
  } catch {
    // Site unreachable — headers/body empty; URL-based evidence may still apply.
  }
  const elapsed = Math.round(performance.now() - t0);

  const base = analyzeShopify(html, finalUrl);
  const res = applyHeaderSignals(base, headers);

  const body = {
    input_url: raw,
    final_url: finalUrl,
    is_shopify: res.verdict === "yes",
    verdict: res.verdict,
    confidence: Math.round(res.confidence) / 100,
    confidence_pct: res.confidence,
    shop_domain: res.shopDomain,
    theme: res.theme,
    currency: res.currency,
    plus: res.plus,
    detected_signals: res.hits.map((h: { label: string }) => h.label),
    signals_detail: res.hits,
    headers_sample: headers,
    elapsed_ms: elapsed,
  };
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 500) { const oldest = cache.keys().next().value; if (oldest) cache.delete(oldest); }
  log("shopify_check", { host: target.hostname, verdict: res.verdict, conf: res.confidence, ms: elapsed });
  return json(body, 200, { "x-tooldeck-cache": "miss", "Cache-Control": "public, max-age=300" });
});
