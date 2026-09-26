import { preflight, json, fail, log } from "../_shared/http.ts";
import { rateLimit, clientIp } from "../_shared/ratelimit.ts";
import { analyzeShopify, applyHeaderSignals, applyProbeSignals, looksBlockedPage } from "../../../shared/shopifyCore/detect.mjs";
import { safeFetch, assertFetchable, BlockedUrlError } from "../../../shared/net/safeFetch.mjs";

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
      /* safeFetch re-validates the (post-redirect) origin and every hop, caps the body and
         aborts on the shared deadline — never fetch(redirect:"follow") on user-derived URLs */
      const r = await safeFetch(origin + path, {
        maxBytes: cap, maxRedirects: 2, timeoutMs: 6_000,
        headers: { "User-Agent": "ToolDeckBot/2.0 (+https://tooldeck.in/tool/shopify) shopify-check", "Accept": "application/json, text/plain, */*" },
        fetchImpl: (u: string, init: RequestInit) =>
          fetch(u, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal }),
      });
      if (r.ok) for (const k of HEADER_SAMPLE_KEYS) { const v = r.headers.get(k); if (v != null && probeHeaders[k] == null) probeHeaders[k] = v; }
      if (!r.ok) return null;
      return r.text;
    } catch { return null; }
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
  const rl = rateLimit(`shopify:${clientIp(req)}`, Number(Deno.env.get("SHOPIFY_RATE_LIMIT_MAX") ?? 30));
  if (!rl.ok) return json({ error: { code: "rate_limited", message: "Too many checks — try again in a minute." } }, 429, { "Retry-After": String(rl.retryAfter ?? 60) });

  const raw = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!raw) return fail(400, "missing_url", "Pass ?url=example.com");

  let target: URL;
  try { target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return fail(400, "invalid_url", "That does not look like a valid URL."); }
  if (!/^https?:$/.test(target.protocol)) return fail(400, "invalid_url", "Only http(s) URLs are supported.");
  // Literal + DNS-resolved range check (loopback, RFC1918, link-local/metadata, CGNAT, ULA…)
  try { await assertFetchable(target); }
  catch (e) {
    const reason = e instanceof BlockedUrlError ? e.reason : "";
    if (reason === "dns-no-answer") return fail(400, "unresolvable_host", "That hostname does not resolve.");
    if (reason.startsWith("port-not-allowed")) return fail(400, "invalid_url", "Only ports 80 and 443 can be checked.");
    return fail(400, "blocked_host", "Private and internal hosts cannot be checked.");
  }

  const key = target.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return json(hit.body, 200, { "x-tooldeck-cache": "hit", "Cache-Control": "public, max-age=300" });
  }

  const t0 = performance.now();
  let html = "", finalUrl = target.href, fetchStatus: number | null = null;
  const headers: Record<string, string> = {};
  try {
    // Walks redirects itself and re-validates every hop, so a 302 into private
    // space is refused; body is capped so giant pages can't hurt us.
    const r = await safeFetch(target.href, {
      maxRedirects: 4, timeoutMs: 12_000, maxBytes: 1_500_000,
      headers: { "User-Agent": "ToolDeckBot/2.0 (+https://tooldeck.in/tool/shopify) shopify-check" },
    });
    finalUrl = r.finalUrl || finalUrl;
    fetchStatus = r.status;
    for (const k of HEADER_SAMPLE_KEYS) { const v = r.headers.get(k); if (v != null) headers[k] = v; }
    html = r.text;
  } catch (e) {
    if (e instanceof BlockedUrlError && /^(literal|resolved):/.test(e.reason)) {
      return fail(400, "blocked_host", "That site redirects to a private or internal address and cannot be checked.");
    }
    // Site unreachable — headers/body empty; URL-based evidence may still apply.
  }
  const elapsed = Math.round(performance.now() - t0);

  // A challenge / rate-limit interstitial is "could not see the page", not "not Shopify".
  const blocked = fetchStatus != null && (fetchStatus === 403 || fetchStatus === 429 || looksBlockedPage(html));
  const base = analyzeShopify(blocked ? "" : html, finalUrl);
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

  // With nothing but a bot wall and no header/probe evidence the honest answer is "unknown".
  if (blocked && res.evidence === "text" && res.confidence < 25) {
    (res as any).verdict = "uncertain";
  }
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
    page_blocked: blocked,
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
