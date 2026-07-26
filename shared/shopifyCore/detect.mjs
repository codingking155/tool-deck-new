/** Shopify detection engine v3 — shared between the browser tool and the
    server API (Supabase Edge Function). Pure ESM, zero dependencies.
 
    Three tiers of evidence, weakest to strongest:
      1. text     — markers in the page HTML (spoofable, capped at 92)
      2. headers  — platform response headers (server-only, capped at 98)
      3. probe    — live Shopify endpoints answering (/cart.js JSON etc.)
    Context matters: a script tag LOADING cdn.shopify.com is evidence; a news
    article MENTIONING cdn.shopify.com is not. Competitor-platform markers
    (WooCommerce, Magento, …) veto weak Shopify scores. */

const CAP_TEXT = 92;
const CAP_HARD = 98;          // detection is never claimed as certain

function verdictOf(confidence) {
  return confidence >= 55 ? "yes" : confidence >= 25 ? "uncertain" : "no";
}

/* ── HTML signals — strong forms require attribute / code context ─────── */

export const SHOPIFY_SIGNALS = [
  { id: "cdn", w: 30, label: "Shopify CDN assets loaded (cdn.shopify.com / /cdn/shop/)",
    re: /(?:src|href|srcset|data-src|content|action)\s*=\s*["'][^"']*(?:cdn\.shopify\.com|\/cdn\/shop\/)|url\(["']?[^)"']*cdn\.shopify\.com/i },
  { id: "obj", w: 25, label: "Shopify JavaScript object (window.Shopify)",
    re: /window\.Shopify\b|Shopify\.(?:theme|shop|routes|currency|locale)\s*=/i },
  { id: "myshop", w: 22, label: "myshopify.com reference in code or markup",
    re: /["'=/([\s][a-z0-9][a-z0-9-]{1,60}\.myshopify\.com/i },
  { id: "analytics", w: 15, label: "ShopifyAnalytics / trekkie beacon",
    re: /ShopifyAnalytics\b|trekkie\.(?:load|factory)|"Trekkie"/i },
  { id: "section", w: 12, label: "Theme sections (shopify-section markup)",
    re: /(?:id|class)\s*=\s*["'][^"']*shopify-section|data-shopify(?:-editor)?\b/i },
  { id: "checkout", w: 12, label: "Cart / checkout endpoints (/cart/add, cart.js, /checkouts/)",
    re: /action\s*=\s*["'][^"']*\/cart\/add|["'/]cart\.js\b|\/checkouts\//i },
  { id: "shoppay", w: 8, label: "Shop Pay component (also embeddable off-platform)",
    re: /shop-pay-wallet|shopify_pay\b|pay\.shopify\.com|cdn\.shopify\.com\/shopifycloud\/shop-js/i },
  { id: "headless", w: 15, label: "Storefront API (headless Shopify)",
    re: /myshopify\.com\/api\/\d{4}-\d{2}\/graphql|storefront-access-token|x-shopify-storefront-access-token/i },
  { id: "plus", w: 0, label: "Shopify Plus indicator", bonus: true,
    re: /Shopify\.Plus\b|shopifycloud\/checkout/i },
];

/* prose-only mention of Shopify infrastructure — nearly worthless as evidence */
const MENTION_RE = /cdn\.shopify\.com|\.myshopify\.com|shopify/i;
const MENTION_W = 4;

/* ── competitor platforms — vetoes weak Shopify scores ────────────────── */

export const PLATFORM_SIGNALS = [
  { name: "WooCommerce", re: /wp-content\/plugins\/woocommerce|class\s*=\s*["'][^"']*\bwoocommerce(?:-page|\b)/i },
  { name: "Magento", re: /\bMagento_[A-Z]|\/static\/version\d{8,}\/frontend\/|mage\/cookies/i },
  { name: "BigCommerce", re: /cdn\d*\.bigcommerce\.com|stencil-utils|data-stencil/i },
  { name: "Wix", re: /static\.wixstatic\.com|wix-warmup-data|wixBiSession/i },
  { name: "Squarespace", re: /static1\.squarespace\.com|squarespace\.com\/universal|Static\.SQUARESPACE_CONTEXT/i },
  { name: "Webflow", re: /(?:assets(?:-global)?|uploads-ssl)\.website-files\.com|data-wf-site=/i },
  { name: "PrestaShop", re: /var\s+prestashop\s*=|\/modules\/ps_[a-z]/i },
  { name: "Salesforce Commerce", re: /demandware\.static|\/on\/demandware\.store\//i },
];

export function detectPlatform(html) {
  for (const p of PLATFORM_SIGNALS) if (p.re.test(html)) return p.name;
  return null;
}

export function analyzeShopify(html, url = "") {
  const hits = [];
  let score = 0, plus = false, conclusiveHost = false;
  let host = "";
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { /* no usable URL */ }
  if (host.endsWith(".myshopify.com")) {
    /* the platform's own storefront domain — conclusive by definition */
    conclusiveHost = true;
    score += 95; hits.push({ label: "URL is a *.myshopify.com storefront (conclusive)", w: 95 });
  }

  let strongMatched = false;
  for (const s of SHOPIFY_SIGNALS) {
    if (s.re.test(html)) {
      if (s.bonus) { plus = true; continue; }
      strongMatched = true;
      score += s.w; hits.push({ label: s.label, w: s.w });
    }
  }
  /* prose mention only counts when nothing structural matched */
  if (!strongMatched && !conclusiveHost && MENTION_RE.test(html)) {
    score += MENTION_W;
    hits.push({ label: "Shopify mentioned in page text only (weak — not structural)", w: MENTION_W });
  }

  /* competitor veto: clear markers of another platform + weak Shopify
     evidence means the mentions are almost certainly incidental */
  const platform = detectPlatform(html);
  if (platform && !conclusiveHost && score < 55) score = Math.min(score, 15);

  /* extraction */
  const themeMatch = html.match(/Shopify\.theme\s*=\s*{[^}]*"name"\s*:\s*"([^"]+)"/i) || html.match(/"theme_name"\s*:\s*"([^"]+)"/i);
  const themeStoreId = html.match(/"theme_store_id"\s*:\s*(\d+)/i)?.[1] ?? null;
  const domMatch = (url + " " + html).match(/([a-z0-9][a-z0-9-]{1,60})\.myshopify\.com/i);
  const shopDomain = domMatch && !/^(cdn|checkout|admin|api|help|apps|accounts)$/i.test(domMatch[1])
    ? `${domMatch[1].toLowerCase()}.myshopify.com` : null;
  const currencyMatch = html.match(/Shopify\.currency\s*=\s*{[^}]*"active"\s*:\s*"([A-Z]{3})"/i);
  const locale = html.match(/Shopify\.locale\s*=\s*"([a-z]{2}(?:-[A-Z]{2})?)"/i)?.[1] ?? null;
  const country = html.match(/Shopify\.country\s*=\s*"([A-Z]{2})"/i)?.[1] ?? null;

  const confidence = Math.min(conclusiveHost ? CAP_HARD : CAP_TEXT, score);
  return {
    verdict: verdictOf(confidence), confidence, hits, plus,
    theme: themeMatch ? themeMatch[1] : null,
    themeStoreId: themeStoreId ? Number(themeStoreId) : null,
    shopDomain,
    currency: currencyMatch ? currencyMatch[1] : null,
    locale, country, platform,
    evidence: conclusiveHost ? "host" : "text",
    signalsChecked: SHOPIFY_SIGNALS.length + 1,
  };
}

/* ── response-header signals — only a server can read these; the platform
      stamps every storefront response with routing headers ─────────────── */
export const HEADER_SIGNALS = [
  { id: "h-stage", w: 60, label: "x-shopify-stage response header", h: "x-shopify-stage" },
  { id: "h-shopid", w: 60, label: "x-shopid / x-sorting-hat-shopid header", h: ["x-shopid", "x-sorting-hat-shopid"] },
  { id: "h-pod", w: 40, label: "x-sorting-hat-podid header", h: "x-sorting-hat-podid" },
  { id: "h-shard", w: 30, label: "x-shardid header", h: "x-shardid" },
  { id: "h-powered", w: 50, label: "powered-by: Shopify header", h: "powered-by", v: /shopify/i },
];

/** Merge header evidence into an HTML analysis. headers: plain object (lowercased keys). */
export function applyHeaderSignals(res, headers) {
  if (!headers) return res;
  let extra = 0;
  const hits = [...res.hits];
  for (const s of HEADER_SIGNALS) {
    const keys = Array.isArray(s.h) ? s.h : [s.h];
    const k = keys.find((key) => headers[key] != null);
    if (!k) continue;
    if (s.v && !s.v.test(String(headers[k]))) continue;
    extra += s.w; hits.push({ label: s.label, w: s.w });
  }
  if (!extra) return res;
  const confidence = Math.min(CAP_HARD, res.confidence + extra);
  return { ...res, hits, confidence, verdict: verdictOf(confidence), headerEvidence: true, evidence: "headers" };
}

/* ── live endpoint probes — asking Shopify itself, not the page ─────────
      /cart.js and /products.json exist on every Shopify storefront and
      answer with characteristic JSON; a page can fake mentions of them,
      but it cannot fake the platform answering. Server-side only. ─────── */

export const PROBE_SIGNALS = [
  { id: "p-cart", w: 75, label: "/cart.js answered with a live Shopify cart (token + items)" },
  { id: "p-products", w: 60, label: "/products.json answered with a Shopify catalog" },
  { id: "p-robots", w: 30, label: "robots.txt carries Shopify's generated banner" },
];

/** probes: {
      cart?:     { json: bool, token: bool, currency?: string },
      products?: { json: bool, count?: number },
      robots?:   { shopify: bool },
    } — absence of an endpoint is NOT negative evidence (headless stores
    legitimately disable storefront routes), so probes only ever add. */
export function applyProbeSignals(res, probes) {
  if (!probes) return res;
  let extra = 0;
  const hits = [...res.hits];
  const add = (sig) => { extra += sig.w; hits.push({ label: sig.label, w: sig.w }); };
  if (probes.cart?.json && probes.cart.token) add(PROBE_SIGNALS[0]);
  if (probes.products?.json) add(PROBE_SIGNALS[1]);
  if (probes.robots?.shopify) add(PROBE_SIGNALS[2]);
  if (!extra) return res;
  const confidence = Math.min(CAP_HARD, res.confidence + extra);
  return {
    ...res, hits, confidence, verdict: verdictOf(confidence),
    probeEvidence: true, evidence: "probe",
    currency: res.currency ?? probes.cart?.currency ?? null,
    productCount: probes.products?.count ?? res.productCount ?? null,
  };
}

/* ── report ───────────────────────────────────────────────────────────── */

/** Plain-text report for the copy button — pasteable into CRM notes. */
export function buildReport(res, url, ms) {
  const lines = [
    `Shopify check — ${url}`,
    `Verdict: ${res.verdict === "yes" ? "Shopify store detected" : res.verdict === "uncertain" ? "Possibly Shopify" : "Not Shopify"} (${res.confidence}% confidence)`,
  ];
  if (res.shopDomain) lines.push(`Shop domain: ${res.shopDomain}`);
  if (res.theme) lines.push(`Theme: ${res.theme}${res.themeStoreId ? ` (theme store #${res.themeStoreId})` : ""}`);
  if (res.plus) lines.push("Shopify Plus indicators present");
  if (res.currency) lines.push(`Store currency: ${res.currency}`);
  if (res.productCount != null) lines.push(`Catalog visible: ${res.productCount}+ products`);
  if (res.platform && res.verdict !== "yes") lines.push(`Detected platform instead: ${res.platform}`);
  if (ms != null) lines.push(`Response time: ${ms} ms`);
  lines.push(`Signals matched (${res.hits.length}/${res.signalsChecked}):`);
  for (const h of res.hits) lines.push(`  ✓ ${h.label} (+${h.w})`);
  lines.push(`Checked with ToolDeck BLR · ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}
