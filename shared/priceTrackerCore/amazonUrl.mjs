// Amazon product URL → canonical identity (marketplace + ASIN).
//
// Product identity is `${marketplace}:${ASIN}`, never the pasted URL, so
// affiliate tags, tracking params, mobile hosts, language prefixes and the
// many Amazon path formats all collapse onto one tracked product.

import { AMAZON_MARKETPLACES } from "./marketplaces.mjs";

/* Short-link hosts only ever redirect; they're resolved server-side (see resolveShortLink). */
export const SHORT_LINK_HOSTS = new Set(["amzn.to", "amzn.in", "amzn.eu", "amzn.asia", "a.co"]);
/* amzn.com/<ASIN> is a legacy US short form that carries the ASIN directly. */
const DIRECT_SHORT = { "amzn.com": "amazon.com" };

const ASIN_RE = /^(?:B[0-9A-Z]{9}|\d{9}[\dX])$/;
const PATH_RES = [
  /\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing|product-reviews|o\/asin|dp\/product|exec\/obidos\/asin|exec\/obidos\/tg\/detail\/-)\/([A-Z0-9]{10})(?=[/?#]|$)/i,
];

/** Map a hostname onto a known marketplace domain, or null. */
export function marketplaceForHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (DIRECT_SHORT[host]) return DIRECT_SHORT[host];
  // longest match first so "amazon.com.au" wins over "amazon.com"
  const domains = Object.keys(AMAZON_MARKETPLACES).sort((a, b) => b.length - a.length);
  for (const d of domains) if (host === d || host.endsWith("." + d)) return d;
  return null;
}

function toUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
}

export function canonicalUrl(marketplace, asin) {
  return `https://www.${marketplace}/dp/${asin}`;
}

export function productKey(marketplace, asin) {
  return `${marketplace}:${asin}`;
}

/** Extract an ASIN from an Amazon URL's path or `asin` query param. */
export function extractAsin(u) {
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  for (const re of PATH_RES) {
    const m = path.match(re);
    if (m && ASIN_RE.test(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  for (const key of ["asin", "ASIN"]) {
    const q = (u.searchParams.get(key) || "").toUpperCase();
    if (ASIN_RE.test(q)) return q;
  }
  return null;
}

/**
 * @returns {{ok:true, store:"amazon", marketplace:string, asin:string, canonicalUrl:string, productKey:string}
 *          | {ok:false, code:"short_link", url:string}
 *          | {ok:false, code:string, message:string}}
 */
export function parseProductUrl(input) {
  const u = toUrl(input);
  if (!u || !/^https?:$/.test(u.protocol)) {
    return { ok: false, code: "invalid_url", message: "That doesn't look like a product link. Paste the full Amazon product URL." };
  }
  const host = u.hostname.toLowerCase();
  if (SHORT_LINK_HOSTS.has(host)) return { ok: false, code: "short_link", url: u.href };

  const marketplace = marketplaceForHost(host);
  if (!marketplace) {
    return { ok: false, code: "unsupported_store", message: "Only Amazon product links are supported right now." };
  }
  let asin;
  if (DIRECT_SHORT[host]) {
    const seg = u.pathname.split("/").filter(Boolean)[0]?.toUpperCase() || "";
    asin = ASIN_RE.test(seg) ? seg : extractAsin(u);
  } else {
    asin = extractAsin(u);
  }
  if (!asin) {
    return { ok: false, code: "no_product_id", message: "This Amazon link doesn't point to a single product. Open the product page and copy its link." };
  }
  return { ok: true, store: "amazon", marketplace, asin, canonicalUrl: canonicalUrl(marketplace, asin), productKey: productKey(marketplace, asin) };
}

/**
 * Follow an Amazon short link (amzn.to, a.co, …) to the product URL it points at.
 * Only short-link and Amazon hosts are ever contacted, and the Amazon page
 * itself is never fetched — we stop as soon as a redirect names an Amazon URL.
 */
export async function resolveShortLink(url, { fetchImpl = fetch, maxHops = 4, timeoutMs = 8000 } = {}) {
  let current = toUrl(url);
  for (let hop = 0; current && hop < maxHops; hop++) {
    const host = current.hostname.toLowerCase();
    if (!SHORT_LINK_HOSTS.has(host)) break;
    if (current.protocol !== "https:" && current.protocol !== "http:") break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(current.href, { method: "GET", redirect: "manual", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    try { await res.body?.cancel(); } catch { /* no body */ }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    let next;
    try { next = new URL(loc, current); } catch { break; }
    const parsed = parseProductUrl(next.href);
    if (parsed.ok) return parsed;
    if (parsed.code !== "short_link") return parsed;
    current = next;
  }
  return { ok: false, code: "short_link_unresolved", message: "That short link couldn't be expanded. Open it and copy the full product URL instead." };
}
