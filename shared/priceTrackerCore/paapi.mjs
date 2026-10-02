// Amazon Product Advertising API 5.0 — GetItems, signed with AWS SigV4.
//
// This is Amazon's official, authorized product-data API (requires an Amazon
// Associates account: access key, secret key, partner tag). Keys live only in
// server-side env; nothing here runs in the browser.
//
// Offers resources: Amazon is moving PA-API from `Offers` (V1) to `OffersV2`.
// Both response shapes are parsed; which resources are *requested* is chosen by
// `offersVersion` ("v2" default, "v1" for accounts/locales still on V1).

import { marketplaceInfo } from "./marketplaces.mjs";

const SERVICE = "ProductAdvertisingAPI";
const TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";
const PATH = "/paapi5/getitems";

const RESOURCES = {
  v2: [
    "ItemInfo.Title", "Images.Primary.Large",
    "OffersV2.Listings.Price", "OffersV2.Listings.Availability", "OffersV2.Listings.MerchantInfo",
    "OffersV2.Listings.Condition", "OffersV2.Listings.IsBuyBoxWinner",
  ],
  v1: [
    "ItemInfo.Title", "Images.Primary.Large",
    "Offers.Listings.Price", "Offers.Listings.SavingBasis", "Offers.Listings.Availability.Message",
    "Offers.Listings.Availability.Type", "Offers.Listings.MerchantInfo", "Offers.Listings.Condition",
  ],
};

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(data) {
  return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** SigV4 signing key (exported for the AWS reference-vector test). */
export async function signingKey(secretKey, dateStamp, region, service) {
  const kDate = await hmac("AWS4" + secretKey, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Build signed headers for a PA-API POST. `now` is injectable for tests. */
export async function signRequest({ host, region, accessKey, secretKey, body, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");   // 20260928T101500Z
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": TARGET,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = ["POST", PATH, "", canonicalHeaders, signedHeaders, await sha256Hex(body)].join("\n");
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = hex(await hmac(await signingKey(secretKey, dateStamp, region, SERVICE), stringToSign));
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function pickListing(listings) {
  if (!Array.isArray(listings) || !listings.length) return null;
  const isNew = (l) => !l.Condition?.Value || /^new$/i.test(l.Condition.Value);
  return listings.find((l) => l.IsBuyBoxWinner && isNew(l)) || listings.find(isNew) || null;
}

/**
 * Normalize one PA-API item. Fields PA-API didn't return stay null — nothing is
 * inferred. `price` is null when Amazon returned no (new) offer for the item.
 */
export function normalizeItem(item, { marketplace, fetchedAt, source = "amazon-paapi" }) {
  const v2 = pickListing(item?.OffersV2?.Listings);
  const v1 = v2 ? null : pickListing(item?.Offers?.Listings);
  let price = null, currency = null, originalPrice = null, availability = null, seller = null;
  if (v2) {
    price = num(v2.Price?.Money?.Amount);
    currency = v2.Price?.Money?.Currency ?? null;
    originalPrice = num(v2.Price?.SavingBasis?.Money?.Amount);
    availability = v2.Availability?.Message || v2.Availability?.Type || null;
    seller = v2.MerchantInfo?.Name ?? null;
  } else if (v1) {
    price = num(v1.Price?.Amount);
    currency = v1.Price?.Currency ?? null;
    originalPrice = num(v1.SavingBasis?.Amount);
    availability = v1.Availability?.Message || v1.Availability?.Type || null;
    seller = v1.MerchantInfo?.Name ?? null;
  }
  if (originalPrice != null && price != null && originalPrice <= price) originalPrice = null;
  return {
    marketplace,
    externalId: item.ASIN,
    title: item.ItemInfo?.Title?.DisplayValue ?? null,
    image: item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL ?? null,
    detailPageUrl: item.DetailPageURL ?? null,
    price,
    currency: currency ?? (price != null ? marketplaceInfo(marketplace)?.currency ?? null : null),
    originalPrice,
    availability: availability ?? (price == null ? "Currently unavailable" : null),
    seller,
    fetchedAt,
    source,
  };
}

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, status = 0 } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

/**
 * GetItems for up to 10 ASINs in one marketplace.
 * @returns {Promise<Map<string, {ok:true, item:object} | {ok:false, code:string, message:string}>>}
 */
export async function getItems(asins, marketplace, cfg, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const info = marketplaceInfo(marketplace);
  if (!info) throw new ProviderError("unsupported_marketplace", `No PA-API endpoint for ${marketplace}.`);
  if (asins.length > 10) throw new ProviderError("too_many_items", "PA-API GetItems accepts at most 10 ASINs.");
  const body = JSON.stringify({
    ItemIds: asins,
    ItemIdType: "ASIN",
    PartnerTag: cfg.partnerTag,
    PartnerType: "Associates",
    Marketplace: `www.${marketplace}`,
    Resources: RESOURCES[cfg.offersVersion === "v1" ? "v1" : "v2"],
  });
  const fetchedAt = now().toISOString();
  const headers = await signRequest({ host: info.paapiHost, region: info.region, accessKey: cfg.accessKey, secretKey: cfg.secretKey, body, now: now() });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10_000);
  let res;
  try {
    res = await fetchImpl(`https://${info.paapiHost}${PATH}`, { method: "POST", headers, body, signal: ctrl.signal });
  } catch (e) {
    throw new ProviderError("network", "Could not reach the Amazon product API.", { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429) throw new ProviderError("rate_limited", "Amazon product API rate limit reached.", { retryable: true, status: 429 });
  if (!res.ok && !data?.ItemsResult) {
    const err = data?.Errors?.[0];
    throw new ProviderError(err?.Code || `http_${res.status}`, err?.Message || `Amazon product API returned HTTP ${res.status}.`,
      { retryable: res.status >= 500, status: res.status });
  }

  const out = new Map();
  for (const item of data?.ItemsResult?.Items ?? []) {
    out.set(item.ASIN, { ok: true, item: normalizeItem(item, { marketplace, fetchedAt }) });
  }
  for (const err of data?.Errors ?? []) {
    const asin = asins.find((a) => String(err.Message || "").includes(a));
    if (asin && !out.has(asin)) {
      out.set(asin, { ok: false, code: err.Code === "ItemNotAccessible" || err.Code === "InvalidParameterValue" ? "not_found" : err.Code || "error", message: err.Message || "Item not available." });
    }
  }
  for (const a of asins) if (!out.has(a)) out.set(a, { ok: false, code: "not_found", message: "Amazon didn't return this product." });
  return out;
}
