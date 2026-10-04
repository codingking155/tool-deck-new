// Keepa — licensed Amazon price-history provider (optional).
//
// Used to import GENUINE historical observations so a newly tracked product
// doesn't start empty. Every imported point keeps Keepa's own timestamp and is
// stored with source "keepa-amazon" or "keepa-new". Nothing is interpolated.
//
// Format notes (Keepa API docs): product.csv[i] is a flat [time, price, time,
// price, …] array; time is "Keepa minutes" (minutes since 2011-01-01 UTC);
// price is in the locale's smallest currency unit; -1 means no offer.
// csv[0] = sold by Amazon, csv[1] = lowest new (incl. third-party sellers).

import { marketplaceInfo } from "./marketplaces.mjs";

const KEEPA_EPOCH_MIN = 21564000;
const ZERO_DECIMAL = new Set(["JPY"]);

export const keepaMinutesToIso = (m) => new Date((Number(m) + KEEPA_EPOCH_MIN) * 60000).toISOString();

function series(csv, currency) {
  if (!Array.isArray(csv)) return [];
  const div = ZERO_DECIMAL.has(currency) ? 1 : 100;
  const pts = [];
  for (let i = 0; i + 1 < csv.length; i += 2) {
    const t = csv[i], p = csv[i + 1];
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    pts.push({ observedAt: keepaMinutesToIso(t), price: p < 0 ? null : Math.round((p / div) * 100) / 100 });
  }
  return pts;
}

/**
 * Turn a Keepa product into observations + a latest-known snapshot.
 * Prefers the "sold by Amazon" series; falls back to lowest-new when Amazon
 * itself never sold the item. Out-of-stock stretches (-1) are kept as
 * price=null observations so the chart shows the real gap instead of bridging it.
 */
export function parseKeepaProduct(p, marketplace) {
  const currency = marketplaceInfo(marketplace)?.currency ?? null;
  const amazon = series(p?.csv?.[0], currency);
  const useAmazon = amazon.some((x) => x.price != null);
  const pts = useAmazon ? amazon : series(p?.csv?.[1], currency);
  const source = useAmazon ? "keepa-amazon" : "keepa-new";
  const observations = pts.map((x) => ({
    price: x.price,
    availability: x.price == null ? "Out of stock" : null,
    observedAt: x.observedAt,
    source,
  }));
  const last = observations[observations.length - 1] || null;
  const images = String(p?.imagesCSV || "").split(",").filter(Boolean);
  const confirmedAt = p?.lastUpdate ? keepaMinutesToIso(p.lastUpdate) : last?.observedAt ?? null;
  return {
    title: p?.title || null,
    image: images[0] ? `https://m.media-amazon.com/images/I/${images[0]}` : null,
    currency,
    observations,
    latest: last && {
      price: last.price,
      availability: last.availability,
      // Keepa confirmed the price was unchanged up to its last refresh of this product.
      observedAt: confirmedAt && confirmedAt > last.observedAt ? confirmedAt : last.observedAt,
      source,
    },
  };
}

/** Fetch history for up to 20 ASINs of one marketplace. */
export async function keepaProducts(asins, marketplace, { apiKey, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const domain = marketplaceInfo(marketplace)?.keepaDomain;
  if (!domain) return new Map();
  const url = `https://api.keepa.com/product?key=${encodeURIComponent(apiKey)}&domain=${domain}&asin=${asins.map(encodeURIComponent).join(",")}&history=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    const out = new Map();
    if (!res.ok || !data || data.error) return out;
    for (const p of data.products ?? []) if (p?.asin) out.set(p.asin, parseKeepaProduct(p, marketplace));
    return out;
  } catch {
    return new Map();   // history is best-effort; the live price path doesn't depend on it
  } finally {
    clearTimeout(timer);
  }
}
