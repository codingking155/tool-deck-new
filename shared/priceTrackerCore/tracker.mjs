// Tracking orchestration: lookup, live refresh, observation recording, history
// import. Storage is an injected `repo` (Supabase in the Edge Functions, in-memory
// in tests), so this file holds all the rules and none of the SQL.
//
// repo interface (all async):
//   findProduct(marketplace, externalId) -> row | null
//   createProduct({marketplace, external_id, canonical_url}) -> row
//   updateProduct(id, patch) -> row
//   latestObservation(productId) -> obs | null
//   insertObservations(rows) -> void          (must ignore (product_id, observed_at, source) duplicates)
//   listObservations(productId, sinceIso|null) -> obs[] ascending

import { parseProductUrl, resolveShortLink } from "./amazonUrl.mjs";
import { fetchLive, fetchHistory, isConfigured } from "./provider.mjs";
import { shouldRecord } from "./series.mjs";

export const UNAVAILABLE_MESSAGE = "Unable to retrieve the latest price right now.";
const MIN = 60_000;

/** @param {(key: string) => string} [getEnv] */
export function defaultIntervals(getEnv = () => "") {
  const n = (k, d) => (Number(getEnv(k)) > 0 ? Number(getEnv(k)) : d) * MIN;
  return {
    checkMs: n("PRICE_CHECK_INTERVAL_MINUTES", 360),            // every 6 h
    alertCheckMs: n("PRICE_ALERT_CHECK_INTERVAL_MINUTES", 60),  // hourly while an alert watches it
    retryMs: n("PRICE_CHECK_RETRY_MINUTES", 30),                // after a transient failure
    minRefreshMs: n("PRICE_MIN_REFRESH_MINUTES", 10),           // on-demand lookups reuse fresher data
  };
}

const toObservationRow = (productId, r, currency) => ({
  product_id: productId,
  price: r.price,
  original_price: r.originalPrice ?? null,
  currency: currency ?? null,
  availability: r.availability ?? null,
  seller: r.seller ?? null,
  observed_at: r.observedAt,
  source: r.source,
});
const asReading = (o) => o && ({ price: o.price == null ? null : Number(o.price), availability: o.availability, seller: o.seller, observedAt: o.observed_at });

async function importKeepa(repo, product, k) {
  if (!k?.observations?.length) return 0;
  const rows = k.observations.map((o) => toObservationRow(product.id, { ...o, originalPrice: null, seller: null }, k.currency));
  await repo.insertObservations(rows);
  return rows.length;
}

/**
 * Refresh live prices for a set of products (grouped per marketplace, 10 per
 * PA-API call). Records an observation only when shouldRecord() says so, and
 * never overwrites the last real price on failure.
 * @returns Map<productId, {ok, code?, message?}>
 */
/** @param {any[]} products @param {any} deps @returns {Promise<Map<string, any>>} */
export async function refreshProducts(products, { repo, cfg, fetchImpl, now = () => new Date(), intervalMsFor, keepEarlierSchedule = false }) {
  const results = new Map();
  const byMarket = new Map();
  for (const p of products) {
    if (!byMarket.has(p.marketplace)) byMarket.set(p.marketplace, []);
    byMarket.get(p.marketplace).push(p);
  }
  for (const [marketplace, list] of byMarket) {
    for (let i = 0; i < list.length; i += 10) {
      const chunk = list.slice(i, i + 10);
      const live = await fetchLive(chunk.map((p) => p.external_id), marketplace, cfg, { fetchImpl, now });
      for (const product of chunk) {
        const t = now();
        const r = live.get(product.external_id);
        const interval = intervalMsFor ? intervalMsFor(product) : 6 * 60 * MIN;
        // An on-demand lookup must not push back a check the scheduler already
        // planned sooner (e.g. the hourly cadence of an alert-watched product).
        const nextAt = (ms) => {
          const at = t.getTime() + ms;
          const planned = product.next_check_at ? new Date(product.next_check_at).getTime() : NaN;
          return new Date(keepEarlierSchedule && planned > t.getTime() && planned < at ? planned : at).toISOString();
        };
        if (!r?.ok) {
          await repo.updateProduct(product.id, {
            last_checked_at: t.toISOString(),
            last_check_status: r?.code === "not_found" ? "not_found" : "error",
            last_error: r?.message ?? UNAVAILABLE_MESSAGE,
            next_check_at: nextAt(r?.retryable ? Math.min(interval, 30 * MIN) : interval),
          });
          results.set(product.id, { ok: false, code: r?.code ?? "error", message: r?.message ?? UNAVAILABLE_MESSAGE });
          continue;
        }
        const currency = r.product.currency ?? product.currency ?? null;
        const latest = asReading(await repo.latestObservation(product.id));
        // A fallback source (Keepa) can return a reading older than the one we
        // already hold. Never let it replace a newer real price.
        const newestKnown = Math.max(
          latest?.observedAt ? new Date(latest.observedAt).getTime() : 0,
          product.last_observed_at ? new Date(product.last_observed_at).getTime() : 0,
        );
        if (new Date(r.reading.observedAt).getTime() < newestKnown) {
          await repo.updateProduct(product.id, {
            last_checked_at: t.toISOString(),
            last_check_status: "error",
            last_error: "The live price source was unavailable; only an older reading came back.",
            next_check_at: nextAt(Math.min(interval, 30 * MIN)),
          });
          results.set(product.id, { ok: false, code: "stale", message: UNAVAILABLE_MESSAGE });
          continue;
        }
        if (shouldRecord(latest, r.reading)) await repo.insertObservations([toObservationRow(product.id, r.reading, currency)]);
        const patch = {
          title: r.product.title ?? product.title ?? null,
          image_url: r.product.image ?? product.image_url ?? null,
          detail_page_url: r.product.detailPageUrl ?? product.detail_page_url ?? null,
          currency,
          current_price: r.reading.price,
          original_price: r.reading.originalPrice ?? null,
          availability: r.reading.availability ?? null,
          seller: r.reading.seller ?? null,
          last_observed_at: r.reading.observedAt,
          last_checked_at: t.toISOString(),
          last_check_status: r.reading.price == null ? "unavailable" : "ok",
          last_error: null,
          next_check_at: nextAt(interval),
        };
        // Keepa already came back as the fallback source — its history is free to keep.
        if (r.keepa && !product.history_imported_at) {
          await importKeepa(repo, product, r.keepa);
          patch.history_imported_at = t.toISOString();
        }
        await repo.updateProduct(product.id, patch);
        results.set(product.id, { ok: true });
      }
    }
  }
  return results;
}

/** Import genuine provider history (Keepa) for products that don't have it yet. */
/** @param {any[]} products @param {any} deps @returns {Promise<number>} */
export async function importMissingHistory(products, { repo, cfg, fetchImpl, now = () => new Date() }) {
  if (!cfg.keepa) return 0;
  let total = 0;
  const byMarket = new Map();
  for (const p of products.filter((x) => !x.history_imported_at)) {
    if (!byMarket.has(p.marketplace)) byMarket.set(p.marketplace, []);
    byMarket.get(p.marketplace).push(p);
  }
  for (const [marketplace, list] of byMarket) {
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20);
      const hist = await fetchHistory(chunk.map((p) => p.external_id), marketplace, cfg, { fetchImpl });
      for (const product of chunk) {
        const k = hist.get(product.external_id);
        if (!k) continue;   // unanswered → try again on a later run
        total += await importKeepa(repo, product, k);
        await repo.updateProduct(product.id, { history_imported_at: now().toISOString() });
      }
    }
  }
  return total;
}

/** Resolve a pasted link to a supported product identity. */
/** @param {string} input @param {any} deps @returns {Promise<any>} */
export async function identify(input, { cfg, fetchImpl }) {
  let parsed = parseProductUrl(input);
  if (!parsed.ok && parsed.code === "short_link") parsed = await resolveShortLink(parsed.url, { fetchImpl });
  if (!parsed.ok) return { ok: false, status: 400, code: parsed.code, message: parsed.message };
  if (!cfg.marketplaces.has(parsed.marketplace)) {
    const list = [...cfg.marketplaces].map((m) => m.replace(/^amazon/, "Amazon")).join(", ");
    return { ok: false, status: 400, code: "unsupported_marketplace", message: `${parsed.marketplace} isn't supported yet. Supported: ${list}.` };
  }
  return { ok: true, ...parsed };
}

/**
 * Paste-a-link lookup: identify → ensure product → refresh unless fresh →
 * import history once → return the product with its real observations.
 */
/** @param {string} input @param {any} deps @returns {Promise<any>} */
export async function lookupProduct(input, { repo, cfg, fetchImpl, now = () => new Date(), intervals, intervalMsFor }) {
  const id = await identify(input, { cfg, fetchImpl });
  if (!id.ok) return id;
  if (!isConfigured(cfg, id.marketplace)) {
    return { ok: false, status: 503, code: "not_configured", message: UNAVAILABLE_MESSAGE, detail: "No live price provider is configured on this server." };
  }

  let product = await repo.findProduct(id.marketplace, id.asin)
    || await repo.createProduct({ marketplace: id.marketplace, external_id: id.asin, canonical_url: id.canonicalUrl });

  // On-demand checks are throttled per product: a check in the last few minutes
  // (by anyone, or by the scheduler) is reused instead of calling the provider again.
  const lastChecked = product.last_checked_at ? new Date(product.last_checked_at).getTime() : 0;
  const recent = lastChecked && now().getTime() - lastChecked < intervals.minRefreshMs;
  let refreshError = !recent || product.last_check_status === "ok" || product.last_check_status === "unavailable"
    ? null : { code: product.last_check_status, message: product.last_error };
  if (!recent) {
    const res = (await refreshProducts([product], { repo, cfg, fetchImpl, now, intervalMsFor: intervalMsFor || (() => intervals.checkMs), keepEarlierSchedule: true })).get(product.id);
    if (!res.ok) refreshError = res;
    product = await repo.findProduct(id.marketplace, id.asin);
  }
  if (cfg.keepa && !product.history_imported_at) {
    await importMissingHistory([product], { repo, cfg, fetchImpl, now });
    product = await repo.findProduct(id.marketplace, id.asin);
  }
  product = await repo.updateProduct(product.id, { last_requested_at: now().toISOString() });

  const observations = await repo.listObservations(product.id, null);
  if (!observations.length) {
    const notFound = refreshError?.code === "not_found";
    return {
      ok: false, status: notFound ? 404 : 502,
      code: notFound ? "not_found" : "price_unavailable",
      message: notFound ? "Amazon didn't return this product. It may be unavailable in this marketplace." : UNAVAILABLE_MESSAGE,
    };
  }
  return {
    ok: true, product, observations,
    // there IS real history, but this particular live check failed → say so
    warning: refreshError ? { code: refreshError.code, message: UNAVAILABLE_MESSAGE } : null,
  };
}

/**
 * The price an alert may be evaluated against: the product's latest real
 * reading, and only if it was confirmed recently. Otherwise null (skip).
 */
export function alertPrice(product, { now = Date.now(), maxAgeMs = 12 * 60 * MIN } = {}) {
  if (!product || product.current_price == null || !product.last_observed_at) return null;
  if (!["ok", "error"].includes(product.last_check_status)) return null;
  if (now - new Date(product.last_observed_at).getTime() > maxAgeMs) return null;
  const p = Number(product.current_price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** Client-facing shape. Observations are passed through untouched. */
export function presentProduct(product, observations, extra = {}) {
  const n = (v) => (v == null ? null : Number(v));
  return {
    id: product.id,
    productKey: product.product_key ?? `${product.marketplace}:${product.external_id}`,
    marketplace: product.marketplace,
    externalId: product.external_id,
    canonicalUrl: product.canonical_url,
    buyUrl: product.detail_page_url || product.canonical_url,
    title: product.title,
    image: product.image_url,
    currency: product.currency,
    // the last real price stays current through a failed check (shown with its as-of time);
    // it's cleared only when the provider says the product is unavailable / gone
    currentPrice: product.last_check_status === "unavailable" || product.last_check_status === "not_found" ? null : n(product.current_price),
    originalPrice: n(product.original_price),
    availability: product.availability,
    seller: product.seller,
    lastObservedAt: product.last_observed_at,
    lastCheckedAt: product.last_checked_at,
    checkStatus: product.last_check_status,
    historyImported: !!product.history_imported_at,
    observations: observations.map((o) => ({
      price: n(o.price), originalPrice: n(o.original_price), availability: o.availability,
      seller: o.seller, observedAt: new Date(o.observed_at).toISOString(), source: o.source,
    })),
    ...extra,
  };
}
