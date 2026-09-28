// Price tracker core. Network is mocked here (tests only) — production code has
// no mock or fallback data paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductUrl, resolveShortLink } from "../shared/priceTrackerCore/amazonUrl.mjs";
import { signingKey, signRequest, getItems, normalizeItem, ProviderError } from "../shared/priceTrackerCore/paapi.mjs";
import { parseKeepaProduct, keepaMinutesToIso } from "../shared/priceTrackerCore/keepa.mjs";
import { providerConfig, fetchLive, isConfigured } from "../shared/priceTrackerCore/provider.mjs";
import { shouldRecord, priceStats } from "../shared/priceTrackerCore/series.mjs";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const envOf = (o) => (k) => o[k] ?? "";

/* ── URL normalization ─────────────────────────────────────────────────── */

test("every Amazon URL shape collapses to marketplace + ASIN", () => {
  const same = [
    "https://www.amazon.in/dp/B0CHX1W1XY",
    "https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY/ref=sr_1_1?crid=2X&keywords=iphone&qid=1&sr=8-1",
    "https://www.amazon.in/dp/B0CHX1W1XY?tag=someaffil-21&linkCode=ll1&th=1&psc=1",
    "https://amazon.in/gp/product/B0CHX1W1XY/",
    "https://m.amazon.in/gp/aw/d/B0CHX1W1XY?ref_=mw_access",
    "https://www.amazon.in/-/hi/dp/B0CHX1W1XY",
    "https://www.amazon.in/dp/b0chx1w1xy",
    "amazon.in/dp/B0CHX1W1XY",
    "https://www.amazon.in/gp/offer-listing/B0CHX1W1XY",
    "https://www.amazon.in/product-reviews/B0CHX1W1XY/ref=cm_cr",
  ];
  for (const u of same) {
    const r = parseProductUrl(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.productKey, "amazon.in:B0CHX1W1XY", u);
    assert.equal(r.canonicalUrl, "https://www.amazon.in/dp/B0CHX1W1XY", u);
  }
});

test("marketplace is taken from the domain (longest match wins)", () => {
  assert.equal(parseProductUrl("https://www.amazon.com.au/dp/B0CHX1W1XY").marketplace, "amazon.com.au");
  assert.equal(parseProductUrl("https://www.amazon.com/dp/B0CHX1W1XY").marketplace, "amazon.com");
  assert.equal(parseProductUrl("https://amzn.com/B0CHX1W1XY").productKey, "amazon.com:B0CHX1W1XY");
  assert.equal(parseProductUrl("https://www.amazon.in/dp/0143442295").asin, "0143442295");   // ISBN-10 ASIN
});

test("non-product and non-Amazon links are refused, short links flagged", () => {
  assert.equal(parseProductUrl("https://www.flipkart.com/x/p/itm123").code, "unsupported_store");
  assert.equal(parseProductUrl("https://www.amazon.in/s?k=iphone").code, "no_product_id");
  assert.equal(parseProductUrl("https://evil-amazon.in.example.com/dp/B0CHX1W1XY").code, "unsupported_store");
  assert.equal(parseProductUrl("not a url at all").code, "invalid_url");
  assert.equal(parseProductUrl("javascript:alert(1)").code, "invalid_url");
  assert.deepEqual(parseProductUrl("https://amzn.to/3abcXYZ"), { ok: false, code: "short_link", url: "https://amzn.to/3abcXYZ" });
});

test("short links resolve via redirects without ever fetching Amazon itself", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "https://amzn.to/3abc") return new Response(null, { status: 301, headers: { location: "https://a.co/d/xyz" } });
    if (url === "https://a.co/d/xyz") return new Response(null, { status: 302, headers: { location: "https://www.amazon.in/dp/B0CHX1W1XY?tag=x-21&smid=1" } });
    throw new Error("unexpected fetch " + url);
  };
  const r = await resolveShortLink("https://amzn.to/3abc", { fetchImpl });
  assert.equal(r.productKey, "amazon.in:B0CHX1W1XY");
  assert.deepEqual(calls, ["https://amzn.to/3abc", "https://a.co/d/xyz"]);

  const dead = await resolveShortLink("https://amzn.to/zzz", { fetchImpl: async () => new Response("nope", { status: 404 }) });
  assert.equal(dead.code, "short_link_unresolved");
});

/* ── PA-API ────────────────────────────────────────────────────────────── */

test("SigV4 signing key matches the AWS documentation vector", async () => {
  const k = await signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam");
  assert.equal(hex(k), "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
});

test("signed PA-API headers carry scope, signed headers and target", async () => {
  const h = await signRequest({ host: "webservices.amazon.in", region: "eu-west-1", accessKey: "AKIDEXAMPLE", secretKey: "s", body: "{}", now: new Date("2026-09-28T10:15:00.123Z") });
  assert.equal(h["x-amz-date"], "20260928T101500Z");
  assert.equal(h["x-amz-target"], "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems");
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260928\/eu-west-1\/ProductAdvertisingAPI\/aws4_request, SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
});

const V2_ITEM = {
  ASIN: "B0CHX1W1XY",
  DetailPageURL: "https://www.amazon.in/dp/B0CHX1W1XY?tag=td-21",
  ItemInfo: { Title: { DisplayValue: "Apple iPhone 15 (128 GB) - Black" } },
  Images: { Primary: { Large: { URL: "https://m.media-amazon.com/images/I/71d7rfSl0wL._SL500_.jpg" } } },
  OffersV2: { Listings: [
    { Condition: { Value: "Used" }, Price: { Money: { Amount: 51000, Currency: "INR" } } },
    { IsBuyBoxWinner: true, Condition: { Value: "New" }, Price: { Money: { Amount: 61999, Currency: "INR" }, SavingBasis: { Money: { Amount: 69900, Currency: "INR" } } },
      Availability: { Type: "IN_STOCK", Message: "In stock" }, MerchantInfo: { Name: "Appario Retail Private Ltd" } },
  ] },
};

test("GetItems normalizes the OffersV2 buy-box listing", async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return jsonRes({ ItemsResult: { Items: [V2_ITEM] } }); };
  const res = await getItems(["B0CHX1W1XY"], "amazon.in", { accessKey: "a", secretKey: "s", partnerTag: "td-21" }, { fetchImpl, now: () => new Date("2026-09-28T10:00:00Z") });
  assert.equal(sent.url, "https://webservices.amazon.in/paapi5/getitems");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.Marketplace, "www.amazon.in");
  assert.equal(body.PartnerTag, "td-21");
  assert.ok(body.Resources.includes("OffersV2.Listings.Price"));
  const r = res.get("B0CHX1W1XY");
  assert.equal(r.ok, true);
  assert.deepEqual(
    { price: r.item.price, cur: r.item.currency, orig: r.item.originalPrice, av: r.item.availability, seller: r.item.seller, at: r.item.fetchedAt, title: r.item.title },
    { price: 61999, cur: "INR", orig: 69900, av: "In stock", seller: "Appario Retail Private Ltd", at: "2026-09-28T10:00:00.000Z", title: "Apple iPhone 15 (128 GB) - Black" },
  );
});

test("legacy Offers (V1) shape is parsed too", () => {
  const it = normalizeItem({ ASIN: "B0X0000001", Offers: { Listings: [{ Price: { Amount: 499, Currency: "INR" }, SavingBasis: { Amount: 450 }, Availability: { Message: "Usually dispatched in 2 days" } }] } },
    { marketplace: "amazon.in", fetchedAt: "2026-09-28T00:00:00Z" });
  assert.equal(it.price, 499);
  assert.equal(it.originalPrice, null, "a 'saving basis' at or below the price isn't a discount");
  assert.equal(it.availability, "Usually dispatched in 2 days");
});

test("no offer → price null, never a guessed value", () => {
  const it = normalizeItem({ ASIN: "B0X0000001", ItemInfo: { Title: { DisplayValue: "X" } } }, { marketplace: "amazon.in", fetchedAt: "2026-09-28T00:00:00Z" });
  assert.equal(it.price, null);
  assert.equal(it.currency, null);
  assert.equal(it.availability, "Currently unavailable");
});

test("item-level errors map to not_found; 429 is a retryable ProviderError", async () => {
  const errFetch = async () => jsonRes({ Errors: [{ Code: "ItemNotAccessible", Message: "The ItemId B0NOPE0000 is not accessible through the Product Advertising API." }] }, 400);
  const res = await getItems(["B0NOPE0000"], "amazon.in", { accessKey: "a", secretKey: "s", partnerTag: "t" }, { fetchImpl: errFetch }).catch((e) => e);
  assert.ok(res instanceof ProviderError);   // whole-request 400 with no ItemsResult

  const partial = async () => jsonRes({ ItemsResult: { Items: [V2_ITEM] }, Errors: [{ Code: "ItemNotAccessible", Message: "The ItemId B0NOPE0000 is not accessible." }] });
  const both = await getItems(["B0CHX1W1XY", "B0NOPE0000"], "amazon.in", { accessKey: "a", secretKey: "s", partnerTag: "t" }, { fetchImpl: partial });
  assert.equal(both.get("B0NOPE0000").code, "not_found");

  const limited = await getItems(["B0CHX1W1XY"], "amazon.in", { accessKey: "a", secretKey: "s", partnerTag: "t" }, { fetchImpl: async () => jsonRes({ Errors: [{ Code: "TooManyRequests" }] }, 429) }).catch((e) => e);
  assert.equal(limited.code, "rate_limited");
  assert.equal(limited.retryable, true);
});

/* ── Keepa ─────────────────────────────────────────────────────────────── */

test("Keepa history keeps real timestamps, converts paise, preserves out-of-stock gaps", () => {
  const k = parseKeepaProduct({
    asin: "B0CHX1W1XY", title: "Apple iPhone 15", imagesCSV: "71d7rfSl0wL.jpg,other.jpg",
    csv: [[7000000, 6990000, 7001440, -1, 7002880, 6199900]],
    lastUpdate: 7003000,
  }, "amazon.in");
  assert.equal(keepaMinutesToIso(0), "2011-01-01T00:00:00.000Z");
  assert.deepEqual(k.observations.map((o) => o.price), [69900, null, 61999]);
  assert.equal(k.observations[1].availability, "Out of stock");
  assert.equal(k.observations[0].observedAt, keepaMinutesToIso(7000000));
  assert.equal(k.latest.price, 61999);
  assert.equal(k.latest.observedAt, keepaMinutesToIso(7003000));
  assert.equal(k.observations[0].source, "keepa-amazon");
  assert.equal(k.image, "https://m.media-amazon.com/images/I/71d7rfSl0wL.jpg");
});

test("Keepa falls back to the lowest-new series when Amazon never sold the item", () => {
  const k = parseKeepaProduct({ csv: [[7000000, -1], [7000000, 12345]] }, "amazon.in");
  assert.equal(k.observations[0].source, "keepa-new");
  assert.equal(k.observations[0].price, 123.45);
});

/* ── provider selection ────────────────────────────────────────────────── */

test("with no provider configured, lookups fail — they never produce a number", async () => {
  const cfg = providerConfig(envOf({}));
  assert.equal(isConfigured(cfg, "amazon.in"), false);
  const r = (await fetchLive(["B0CHX1W1XY"], "amazon.in", cfg, { fetchImpl: async () => { throw new Error("must not fetch"); } })).get("B0CHX1W1XY");
  assert.equal(r.ok, false);
  assert.equal(r.code, "not_configured");
});

test("PA-API outage falls back to Keepa's own timestamped reading", async () => {
  const cfg = providerConfig(envOf({ AMAZON_PAAPI_ACCESS_KEY: "a", AMAZON_PAAPI_SECRET_KEY: "s", AMAZON_PAAPI_PARTNER_TAG: "td-21", KEEPA_API_KEY: "k" }));
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://webservices.amazon.in")) return jsonRes({}, 503);
    if (String(url).startsWith("https://api.keepa.com/product")) return jsonRes({ products: [{ asin: "B0CHX1W1XY", title: "T", csv: [[7000000, 6199900]], lastUpdate: 7000100 }] });
    throw new Error("unexpected " + url);
  };
  const r = (await fetchLive(["B0CHX1W1XY"], "amazon.in", cfg, { fetchImpl })).get("B0CHX1W1XY");
  assert.equal(r.ok, true);
  assert.equal(r.reading.price, 61999);
  assert.equal(r.reading.source, "keepa-amazon");
  assert.equal(r.reading.observedAt, keepaMinutesToIso(7000100));
});

test("a PA-API 'not found' is final — no silent substitute", async () => {
  const cfg = providerConfig(envOf({ AMAZON_PAAPI_ACCESS_KEY: "a", AMAZON_PAAPI_SECRET_KEY: "s", AMAZON_PAAPI_PARTNER_TAG: "t" }));
  const r = (await fetchLive(["B0NOPE0000"], "amazon.in", cfg, { fetchImpl: async () => jsonRes({ ItemsResult: { Items: [] } }) })).get("B0NOPE0000");
  assert.deepEqual([r.ok, r.code], [false, "not_found"]);
});

/* ── observations & stats ──────────────────────────────────────────────── */

const at = (d, h = 0) => new Date(Date.UTC(2026, 8, d, h)).toISOString();

test("shouldRecord: changes and daily heartbeats only", () => {
  const last = { price: 100, availability: "In stock", seller: "A", observedAt: at(1) };
  assert.equal(shouldRecord(null, { price: 100, observedAt: at(1) }), true);
  assert.equal(shouldRecord(last, { price: 100, availability: "In stock", seller: "A", observedAt: at(1, 6) }), false);
  assert.equal(shouldRecord(last, { price: 99.5, availability: "In stock", observedAt: at(1, 6) }), true);
  assert.equal(shouldRecord(last, { price: 100, availability: "Out of stock", observedAt: at(1, 6) }), true);
  assert.equal(shouldRecord(last, { price: 100, availability: "In stock", seller: "B", observedAt: at(1, 6) }), true);
  assert.equal(shouldRecord(last, { price: 100, availability: "In stock", seller: "A", observedAt: at(2, 1) }), true);
  assert.equal(shouldRecord(last, { price: 90, observedAt: at(1) }), false, "not newer → ignored");
});

test("one real observation → stats with no verdict and no invented history", () => {
  const s = priceStats([{ price: 61999, observedAt: at(28), source: "amazon-paapi" }], { now: Date.parse(at(28, 1)) });
  assert.equal(s.current.price, 61999);
  assert.equal(s.lowest.price, 61999);
  assert.equal(s.highest.price, 61999);
  assert.equal(s.average, 61999);
  assert.equal(s.pointCount, 1);
  assert.equal(s.enoughHistory, false);
  assert.equal(s.insight, null);
});

test("average is time-weighted over the step series", () => {
  // 100 for 9 days, then 200 for 1 day → (100*9 + 200*1)/10 = 110
  const obs = [{ price: 100, observedAt: at(1), source: "x" }, { price: 200, observedAt: at(10), source: "x" }];
  const s = priceStats(obs, { now: Date.parse(at(11)), asOf: at(11) });
  assert.equal(s.average, 110);
  assert.equal(s.change.amount, 100);
  assert.equal(Math.round(s.change.percent), 100);
});

test("range window carries in the price in force at its start", () => {
  const obs = [{ price: 500, observedAt: at(1), source: "x" }, { price: 400, observedAt: at(25), source: "x" }];
  const s = priceStats(obs, { now: Date.parse(at(30)), rangeDays: 10, asOf: at(30) });
  assert.equal(s.highest.price, 500, "the 500 reading was still in force when the window opened");
  assert.equal(s.lowest.price, 400);
  assert.equal(s.average, 450);   // 5 days @500 + 5 days @400
});

test("out of stock now → no current price, last known price kept separately", () => {
  const obs = [{ price: 300, observedAt: at(1), source: "x" }, { price: null, availability: "Out of stock", observedAt: at(2), source: "x" }];
  const s = priceStats(obs, { now: Date.parse(at(3)) });
  assert.equal(s.current, null);
  assert.equal(s.lastKnown.price, 300);
});

test("insight only with ≥14 days and ≥3 real readings", () => {
  const obs = [
    { price: 1000, observedAt: at(1), source: "x" }, { price: 1000, observedAt: at(10), source: "x" },
    { price: 1000, observedAt: at(20), source: "x" }, { price: 850, observedAt: at(28), source: "x" },
  ];
  const s = priceStats(obs, { now: Date.parse(at(28, 1)), asOf: at(28, 1) });
  assert.equal(s.enoughHistory, true);
  assert.equal(s.insight.kind, "low");
  const short = priceStats(obs.slice(2), { now: Date.parse(at(28, 1)) });
  assert.equal(short.insight, null);
});

/* ── orchestration (in-memory repo) ────────────────────────────────────── */

import { lookupProduct, refreshProducts, alertPrice, presentProduct, defaultIntervals } from "../shared/priceTrackerCore/tracker.mjs";

function memoryRepo() {
  const products = new Map(), obs = [];
  let n = 0;
  return {
    products, obs,
    async findProduct(m, e) { return [...products.values()].find((p) => p.marketplace === m && p.external_id === e) || null; },
    async createProduct(row) { const p = { id: `p${++n}`, product_key: `${row.marketplace}:${row.external_id}`, ...row }; products.set(p.id, p); return p; },
    async updateProduct(id, patch) { const p = { ...products.get(id), ...patch }; products.set(id, p); return p; },
    async latestObservation(pid) { return obs.filter((o) => o.product_id === pid).sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0] || null; },
    async insertObservations(rows) { for (const r of rows) if (!obs.some((o) => o.product_id === r.product_id && o.observed_at === r.observed_at && o.source === r.source)) obs.push(r); },
    async listObservations(pid) { return obs.filter((o) => o.product_id === pid).sort((a, b) => a.observed_at.localeCompare(b.observed_at)); },
  };
}
const paapiCfg = () => providerConfig(envOf({ AMAZON_PAAPI_ACCESS_KEY: "a", AMAZON_PAAPI_SECRET_KEY: "s", AMAZON_PAAPI_PARTNER_TAG: "td-21" }));
const withPrice = (amount) => async () => jsonRes({ ItemsResult: { Items: [{ ...V2_ITEM, OffersV2: { Listings: [{ ...V2_ITEM.OffersV2.Listings[1], Price: { Money: { Amount: amount, Currency: "INR" } } }] } }] } });
const intervals = defaultIntervals();

test("lookup: live price stored as ONE real observation; affiliate/mobile URLs hit the same product", async () => {
  const repo = memoryRepo();
  let clock = new Date("2026-09-28T10:00:00Z");
  const r1 = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY?tag=other-21", { repo, cfg: paapiCfg(), fetchImpl: withPrice(61999), now: () => clock, intervals });
  assert.equal(r1.ok, true);
  assert.equal(r1.observations.length, 1);
  assert.equal(Number(r1.observations[0].price), 61999);
  assert.equal(r1.observations[0].observed_at, "2026-09-28T10:00:00.000Z");
  assert.equal(r1.product.title, "Apple iPhone 15 (128 GB) - Black");

  // 2 minutes later, from the mobile site: same product, throttled (no provider call)
  clock = new Date("2026-09-28T10:02:00Z");
  const r2 = await lookupProduct("https://m.amazon.in/gp/aw/d/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: async () => { throw new Error("should be throttled"); }, now: () => clock, intervals });
  assert.equal(r2.product.id, r1.product.id);
  assert.equal(repo.products.size, 1);

  // an hour later the price drops → a second observation, the first is untouched
  clock = new Date("2026-09-28T11:00:00Z");
  const r3 = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: withPrice(59999), now: () => clock, intervals });
  assert.deepEqual(r3.observations.map((o) => Number(o.price)), [61999, 59999]);
  const view = presentProduct(r3.product, r3.observations);
  assert.equal(view.currentPrice, 59999);
  assert.equal(view.lastObservedAt, "2026-09-28T11:00:00.000Z");
});

test("lookup: unchanged price within a day adds no duplicate row", async () => {
  const repo = memoryRepo();
  let clock = new Date("2026-09-28T10:00:00Z");
  await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: withPrice(61999), now: () => clock, intervals });
  clock = new Date("2026-09-28T16:00:00Z");
  const r = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: withPrice(61999), now: () => clock, intervals });
  assert.equal(r.observations.length, 1);
  assert.equal(r.product.last_observed_at, "2026-09-28T16:00:00.000Z", "the confirmation time still advances");
});

test("lookup: provider failure with no history → honest error, nothing stored", async () => {
  const repo = memoryRepo();
  const r = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: async () => jsonRes({}, 503), intervals });
  assert.equal(r.ok, false);
  assert.equal(r.code, "price_unavailable");
  assert.equal(r.message, "Unable to retrieve the latest price right now.");
  assert.equal(repo.obs.length, 0);
});

test("lookup: failure after real history keeps the last real price and warns", async () => {
  const repo = memoryRepo();
  let clock = new Date("2026-09-28T10:00:00Z");
  await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: withPrice(61999), now: () => clock, intervals });
  clock = new Date("2026-09-28T12:00:00Z");
  const r = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), fetchImpl: async () => jsonRes({}, 503), now: () => clock, intervals });
  assert.equal(r.ok, true);
  assert.equal(r.warning.message, "Unable to retrieve the latest price right now.");
  const view = presentProduct(r.product, r.observations);
  assert.equal(view.currentPrice, 61999);
  assert.equal(view.lastObservedAt, "2026-09-28T10:00:00.000Z", "as-of time is the real reading, not the failed attempt");
});

test("lookup: not configured / unsupported store / unsupported marketplace", async () => {
  const repo = memoryRepo();
  const none = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg: providerConfig(envOf({})), intervals });
  assert.deepEqual([none.ok, none.status, none.code], [false, 503, "not_configured"]);
  const flip = await lookupProduct("https://www.flipkart.com/p/itm1", { repo, cfg: paapiCfg(), intervals });
  assert.equal(flip.code, "unsupported_store");
  const us = await lookupProduct("https://www.amazon.com/dp/B0CHX1W1XY", { repo, cfg: paapiCfg(), intervals });
  assert.equal(us.code, "unsupported_marketplace");
  assert.equal(repo.products.size, 0);
});

test("Keepa history is imported once, with provider timestamps and sources", async () => {
  const repo = memoryRepo();
  const cfg = providerConfig(envOf({ AMAZON_PAAPI_ACCESS_KEY: "a", AMAZON_PAAPI_SECRET_KEY: "s", AMAZON_PAAPI_PARTNER_TAG: "t", KEEPA_API_KEY: "k" }));
  let keepaCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://api.keepa.com")) { keepaCalls++; return jsonRes({ products: [{ asin: "B0CHX1W1XY", csv: [[7000000, 6990000, 7050000, 6499900]] }] }); }
    return withPrice(61999)();
  };
  const now = () => new Date("2026-09-28T10:00:00Z");
  const r = await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg, fetchImpl, now, intervals });
  assert.deepEqual(r.observations.map((o) => o.source), ["keepa-amazon", "keepa-amazon", "amazon-paapi"]);
  assert.equal(r.observations[0].observed_at, keepaMinutesToIso(7000000));
  const later = () => new Date("2026-09-29T10:00:00Z");
  await lookupProduct("https://www.amazon.in/dp/B0CHX1W1XY", { repo, cfg, fetchImpl, now: later, intervals });
  assert.equal(keepaCalls, 1);
});

test("scheduled refresh batches ≤10 ASINs per PA-API call", async () => {
  const repo = memoryRepo();
  const list = [];
  for (let i = 0; i < 12; i++) list.push(await repo.createProduct({ marketplace: "amazon.in", external_id: `B0TEST${String(i).padStart(4, "0")}`, canonical_url: "x" }));
  const sizes = [];
  const fetchImpl = async (url, init) => {
    const ids = JSON.parse(init.body).ItemIds; sizes.push(ids.length);
    return jsonRes({ ItemsResult: { Items: ids.map((a) => ({ ...V2_ITEM, ASIN: a })) } });
  };
  const res = await refreshProducts(list, { repo, cfg: paapiCfg(), fetchImpl });
  assert.deepEqual(sizes, [10, 2]);
  assert.equal([...res.values()].every((r) => r.ok), true);
  assert.equal(repo.obs.length, 12);
});

test("alertPrice: only a fresh, real, confirmed price", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const p = { current_price: "499.00", last_observed_at: "2026-09-28T10:00:00Z", last_check_status: "ok" };
  assert.equal(alertPrice(p, { now }), 499);
  assert.equal(alertPrice({ ...p, last_observed_at: "2026-09-27T20:00:00Z" }, { now }), null, "stale");
  assert.equal(alertPrice({ ...p, last_check_status: "unavailable" }, { now }), null);
  assert.equal(alertPrice({ ...p, current_price: null }, { now }), null);
  assert.equal(alertPrice(null, { now }), null);
});
