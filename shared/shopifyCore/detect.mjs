/** Shopify detection engine — shared between the browser tool and the
    server API (Supabase Edge Function). Pure ESM, zero dependencies. */

/** Shopify detection engine — nine weighted signals scored into a confidence value. */

export const SHOPIFY_SIGNALS = [
  { id:"cdn", w:30, label:"Shopify CDN assets (cdn.shopify.com / cdn/shop)", re:/cdn\.shopify\.com|\/cdn\/shop\//i },
  { id:"obj", w:25, label:"Shopify JavaScript object (window.Shopify)", re:/window\.Shopify|Shopify\.theme|Shopify\.shop/i },
  { id:"myshop", w:25, label:"myshopify.com domain reference", re:/[a-z0-9-]+\.myshopify\.com/i },
  { id:"analytics", w:15, label:"ShopifyAnalytics / trekkie beacon", re:/ShopifyAnalytics|trekkie/i },
  { id:"section", w:10, label:"Theme sections (shopify-section markup)", re:/shopify-section|data-shopify/i },
  { id:"checkout", w:15, label:"Shopify checkout endpoints (/cart, /checkouts)", re:/\/checkouts\/|cart\.js|\/cart\/add/i },
  { id:"shoppay", w:10, label:"Shop Pay / Shopify payments", re:/shop-pay|shopify_pay|shop\.app/i },
  { id:"plus", w:0, label:"Shopify Plus indicator", re:/Shopify\.Plus|shopifycloud\/checkout/i, bonus:true },
  { id:"headless", w:10, label:"Storefront API (headless Shopify)", re:/myshopify\.com\/api\/\d{4}-\d{2}\/graphql|storefront-access-token/i },
];

export function analyzeShopify(html, url = "") {
  const hits = [];
  let score = 0, plus = false;
  let host = "";
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { /* no usable URL */ }
  if (host.endsWith(".myshopify.com")) {
    /* the platform's own storefront domain — conclusive by definition */
    score += 95; hits.push({ label: "URL is a *.myshopify.com storefront (conclusive)", w: 95 });
  }
  for (const s of SHOPIFY_SIGNALS) {
    if (s.re.test(html)) {
      if (s.bonus) { plus = true; continue; }
      score += s.w; hits.push({ label: s.label, w: s.w });
    }
  }
  const themeMatch = html.match(/Shopify\.theme\s*=\s*{[^}]*"name"\s*:\s*"([^"]+)"/i) || html.match(/"theme_name"\s*:\s*"([^"]+)"/i);
  /* the store's own *.myshopify.com identity — skip infrastructure hosts */
  const domMatch = (url + " " + html).match(/([a-z0-9][a-z0-9-]{1,60})\.myshopify\.com/i);
  const shopDomain = domMatch && !/^(cdn|checkout|admin|api|help|apps|accounts)$/i.test(domMatch[1])
    ? `${domMatch[1].toLowerCase()}.myshopify.com` : null;
  const currencyMatch = html.match(/Shopify\.currency\s*=\s*{[^}]*"active"\s*:\s*"([A-Z]{3})"/i);
  const confidence = Math.min(98, score);
  const verdict = confidence >= 55 ? "yes" : confidence >= 25 ? "uncertain" : "no";
  return {
    verdict, confidence, hits, plus,
    theme: themeMatch ? themeMatch[1] : null,
    shopDomain,
    currency: currencyMatch ? currencyMatch[1] : null,
    signalsChecked: SHOPIFY_SIGNALS.length + 1,
  };
}

/** Plain-text report for the copy button — pasteable into CRM notes. */
export function buildReport(res, url, ms) {
  const lines = [
    `Shopify check — ${url}`,
    `Verdict: ${res.verdict === "yes" ? "Shopify store detected" : res.verdict === "uncertain" ? "Possibly Shopify" : "Not Shopify"} (${res.confidence}% confidence)`,
  ];
  if (res.shopDomain) lines.push(`Shop domain: ${res.shopDomain}`);
  if (res.theme) lines.push(`Theme: ${res.theme}`);
  if (res.plus) lines.push("Shopify Plus indicators present");
  if (res.currency) lines.push(`Store currency: ${res.currency}`);
  if (ms != null) lines.push(`Response time: ${ms} ms`);
  lines.push(`Signals matched (${res.hits.length}/${res.signalsChecked}):`);
  for (const h of res.hits) lines.push(`  ✓ ${h.label} (+${h.w})`);
  lines.push(`Checked with ToolDeck BLR · ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

/* ── response-header signals — only a server can read these; they are the
      strongest evidence there is (the platform stamps every response) ── */
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
  const confidence = Math.min(98, res.confidence + extra);
  const verdict = confidence >= 55 ? "yes" : confidence >= 25 ? "uncertain" : "no";
  return { ...res, hits, confidence, verdict, headerEvidence: extra > 0 };
}
