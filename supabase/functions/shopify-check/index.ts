import { preflight, json, fail, log } from "../_shared/http.ts";
import { analyzeShopify, applyHeaderSignals, applyProbeSignals } from "../../../shared/shopifyCore/detect.mjs";

// GET /shopify-check?url=example.com
// Response shape is a superset of shopifyornot.in's /check API, so existing
// Zapier / n8n / Make recipes written for that shape work against this too:
//   is_shopify, confidence (0-1), input_url, final_url, shop_domain,
//   detected_signals, headers_sample, elapsed_ms
//   + extras: verdict, confidence_pct, theme, currency, plus, signals_detail,
//     platform, product_count, probes, evidence

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

/* Live endpoint probes: /cart.js, /products.json and robots.txt exist on
   every Shopify storefront and answer with characteristic content. A page
   can fake MENTIONS of Shopify; it cannot fake the platform answering.
   Absence is not negative evidence (headless stores disable these), and
   every probe is size-capped and time-boxed. */
async function probeEndpoints(origin: string, signal: AbortSignal) {
  /* platform headers on probe RESPONSES count too: a bot-blocked homepage
     serves a bare 429, but /cart.js served by Shopify still stamps
     powered-by / x-shopid — evidence the main fetch never saw */
  const probeHeaders: Record<string, string> = {};
  const get = async (path: string, cap: number): Promise<string | null> => {
    try {
      const r = await fetch(origin + path, {
        redirect: "follow", signal,
        headers: { "User-Agent": "ToolDeckBot/2.0 (+https://tooldeck.in/tool/shopify) shopify-check", "Accept": "application/json, text/plain, */*" },
      });
      if (r.ok) for (const k of HEADER_SAMPLE_KEYS) { const v = r.headers.get(k); if (v != null && probeHeaders[k] == null) probeHeaders[k] = v; }
      if (!r.ok) return null;
      const reader = r.body?.getReader();
      if (!reader) return null;
      let got = 0; const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        if (got > cap) { try { await reader.cancel(); } catch { /* closed */ } break; }
      }
      return new TextDecoder().decode(concat(parts, Math.min(got, cap)));
    } catch { return null; }
  };
  const concat = (parts: Uint8Array[], n: number) => {
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { const take = Math.min(p.length, n - o); out.set(p.subarray(0, take), o); o += take; if (o >= n) break; }
    return out;
  };

  const [cartRaw, prodRaw, robotsRaw] = await Promise.all([
    get("/cart.js", 128 * 1024),
    get("/products.json?limit=1", 256 * 1024),
    get("/robots.txt", 32 * 1024),
  ]);

  const probes: Record<string, unknown> = {};
  if (cartRaw != null) {
    try {
      const j = JSON.parse(cartRaw);
      probes.cart = {
        json: true,
        token: typeof j.token === "string" && Array.isArray(j.items),
        currency: typeof j.currency === "string" ? j.currency : undefined,
      };
    } catch { probes.cart = { json: false }; }
  }
  if (prodRaw != null) {
    try {
      const j = JSON.parse(prodRaw);
      probes.products = Array.isArray(j.products)
        ? { json: true, count: j.products.length }
        : { json: false };
    } catch { probes.products = { json: false }; }
  }
  if (robotsRaw != null) {
    probes.robots = { shopify: /shopify/i.test(robotsRaw) && /sitemap\.xml/i.test(robotsRaw) };
  }
  return { probes, probeHeaders };
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
  const withHeaders = applyHeaderSignals(base, headers);

  /* live endpoint probes against the FINAL origin (post-redirect). These run
     even when the main fetch failed or was bot-blocked (429/403/empty body):
     stores that refuse to serve HTML to non-browsers routinely still answer
     /cart.js and robots.txt — the probes are the whole point in that case. */
  let probes: Record<string, unknown> = {};
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);
    const pr = await probeEndpoints(new URL(finalUrl).origin, ctrl.signal);
    clearTimeout(timer);
    probes = pr.probes;
    /* merge platform headers found on probe responses (main fetch wins ties) */
    for (const [k, v] of Object.entries(pr.probeHeaders)) if (headers[k] == null) headers[k] = v;
  } catch { /* probes are additive-only; failure changes nothing */ }
  const res = applyProbeSignals(withHeaders, probes);

  const body = {
    input_url: raw,
    final_url: finalUrl,
    is_shopify: res.verdict === "yes",
    verdict: res.verdict,
    confidence: Math.round(res.confidence) / 100,
    confidence_pct: res.confidence,
    shop_domain: res.shopDomain,
    theme: res.theme,
    theme_store_id: res.themeStoreId ?? null,
    currency: res.currency,
    plus: res.plus,
    platform: res.platform ?? null,
    product_count: res.productCount ?? null,
    evidence: res.evidence,
    probes,
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
