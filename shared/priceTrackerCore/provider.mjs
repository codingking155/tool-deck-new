// Which real data sources are configured, and how to read from them.
//
//   live price   → Amazon PA-API 5.0 (official). If PA-API isn't configured, or is
//                  temporarily failing, Keepa's latest reading is used instead —
//                  with Keepa's own timestamp, so "as of" stays truthful.
//   history      → Keepa (optional, licensed). Without it, history is whatever
//                  ToolDeck itself has observed since tracking began.
//
// With neither configured, lookups fail with `not_configured`. There is no
// fallback that produces a number.

import { getItems, ProviderError } from "./paapi.mjs";
import { keepaProducts } from "./keepa.mjs";

/** Read provider config from an env getter (Deno.env.get / process.env lookup). */
/** @param {(key: string) => string} getEnv @returns {any} */
export function providerConfig(getEnv) {
  const accessKey = getEnv("AMAZON_PAAPI_ACCESS_KEY"), secretKey = getEnv("AMAZON_PAAPI_SECRET_KEY");
  // Associates partner tags are per locale; the plain tag defaults to amazon.in.
  const tags = {};
  try { Object.assign(tags, JSON.parse(getEnv("AMAZON_PAAPI_PARTNER_TAGS") || "{}")); } catch { /* ignore malformed */ }
  if (getEnv("AMAZON_PAAPI_PARTNER_TAG") && !tags["amazon.in"]) tags["amazon.in"] = getEnv("AMAZON_PAAPI_PARTNER_TAG");
  const paapi = accessKey && secretKey && Object.keys(tags).length
    ? { accessKey, secretKey, tags, offersVersion: getEnv("AMAZON_PAAPI_OFFERS_VERSION") === "v1" ? "v1" : "v2" }
    : null;
  const keepa = getEnv("KEEPA_API_KEY") ? { apiKey: getEnv("KEEPA_API_KEY") } : null;
  const allowed = (getEnv("PRICE_TRACKER_MARKETPLACES") || "amazon.in").split(",").map((s) => s.trim()).filter(Boolean);
  return { paapi, keepa, marketplaces: new Set(allowed) };
}

export function isConfigured(cfg, marketplace) {
  return !!((cfg.paapi && cfg.paapi.tags[marketplace]) || cfg.keepa);
}

function fromPaapi(r) {
  const it = r.item;
  return {
    ok: true,
    product: { title: it.title, image: it.image, detailPageUrl: it.detailPageUrl, currency: it.currency },
    reading: {
      price: it.price, originalPrice: it.originalPrice, availability: it.availability,
      seller: it.seller, observedAt: it.fetchedAt, source: it.source,
    },
  };
}

function fromKeepa(k) {
  if (!k?.latest) return { ok: false, code: "not_found", message: "No price data is available for this product." };
  return {
    ok: true,
    product: { title: k.title, image: k.image, detailPageUrl: null, currency: k.currency },
    reading: { price: k.latest.price, originalPrice: null, availability: k.latest.availability, seller: null, observedAt: k.latest.observedAt, source: k.latest.source },
    keepa: k,
  };
}

/**
 * Current price for up to 10 ASINs of one marketplace.
 * @returns Map<asin, {ok:true, product, reading, keepa?} | {ok:false, code, message, retryable?}>
 */
export async function fetchLive(asins, marketplace, cfg, { fetchImpl = fetch, now } = {}) {
  const out = new Map();
  const tag = cfg.paapi?.tags[marketplace];
  let fallback = asins;
  if (tag) {
    try {
      const res = await getItems(asins, marketplace, { ...cfg.paapi, partnerTag: tag }, { fetchImpl, now });
      fallback = [];
      for (const a of asins) {
        const r = res.get(a);
        if (r.ok) out.set(a, fromPaapi(r));
        else out.set(a, { ok: false, code: r.code, message: r.message });
      }
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("error", String(e?.message || e));
      for (const a of asins) out.set(a, { ok: false, code: err.code, message: err.message, retryable: err.retryable });
      fallback = err.retryable ? asins : [];
    }
  }
  if (fallback.length && cfg.keepa) {
    const k = await keepaProducts(fallback, marketplace, { apiKey: cfg.keepa.apiKey, fetchImpl });
    for (const a of fallback) {
      const r = fromKeepa(k.get(a));
      if (r.ok || !out.has(a)) out.set(a, r);
    }
  }
  for (const a of asins) {
    if (!out.has(a)) out.set(a, { ok: false, code: "not_configured", message: "No live price provider is configured for this marketplace." });
  }
  return out;
}

/** Genuine historical observations from Keepa, when configured. */
export async function fetchHistory(asins, marketplace, cfg, { fetchImpl = fetch } = {}) {
  if (!cfg.keepa) return new Map();
  return keepaProducts(asins, marketplace, { apiKey: cfg.keepa.apiKey, fetchImpl });
}
