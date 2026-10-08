import { test } from "node:test";
import assert from "node:assert/strict";
import { fromApiResponse, reportFromResponse } from "../shared/shopifyCore/detect.mjs";
import { detailTiles, retryAfterSec, verdictLabel } from "../src/lib/shopifyView.js";

const STORE = {
  input_url: "acmestore.in", final_url: "https://acmestore.in/", is_shopify: true, verdict: "yes",
  confidence: 0.98, confidence_pct: 98, shop_domain: "acme-blr.myshopify.com", theme: "Dawn", theme_store_id: 887,
  currency: "INR", plus: true, platform: null, product_count: 1, evidence: "probe", page_blocked: false,
  detected_signals: ["cdn.shopify.com assets", "/cart.js answered"], signals_detail: [{ label: "cdn.shopify.com assets", w: 40 }, { label: "/cart.js answered", w: 75 }],
  elapsed_ms: 812,
};
const NOW = new Date("2026-10-08T10:00:00Z");

test("report from an API response carries every returned fact", () => {
  const rep = reportFromResponse(STORE, NOW);
  assert.match(rep, /^Shopify check — https:\/\/acmestore\.in\//);
  assert.match(rep, /Verdict: Shopify store detected \(98% confidence\)/);
  assert.match(rep, /Shop domain: acme-blr\.myshopify\.com/);
  assert.match(rep, /Theme: Dawn \(theme store #887\)/);
  assert.match(rep, /Shopify Plus indicators present/);
  assert.match(rep, /Store currency: INR/);
  assert.match(rep, /Response time: 812 ms/);
  assert.match(rep, /Signals matched \(2\):/);
  assert.match(rep, /✓ \/cart\.js answered \(\+75\)/);
  assert.match(rep, /2026-10-08$/);
});

test("report omits absent fields and never prints null/undefined", () => {
  const rep = reportFromResponse({ input_url: "woo.in", final_url: "https://woo.in/", is_shopify: false, verdict: "no", confidence_pct: 0,
    shop_domain: null, theme: null, currency: null, plus: false, platform: "WooCommerce", product_count: null, detected_signals: [], elapsed_ms: 300 }, NOW);
  assert.doesNotMatch(rep, /null|undefined|Shop domain|Theme:|Plus|currency|Catalog/);
  assert.match(rep, /Not Shopify \(0% confidence\)/);
  assert.match(rep, /Detected platform instead: WooCommerce/);
});

test("blocked page with no evidence reads as couldn't see, not 'possibly'", () => {
  const rep = reportFromResponse({ final_url: "https://x.com/", verdict: "uncertain", confidence_pct: 0, page_blocked: true, detected_signals: [] }, NOW);
  assert.match(rep, /Couldn't see the page/);
  const partial = reportFromResponse({ final_url: "https://x.com/", verdict: "no", confidence_pct: 10, page_blocked: true, detected_signals: ["a"] }, NOW);
  assert.match(partial, /page itself was blocked/);
  assert.match(partial, /✓ a$/m);   // labels-only fallback has no weight suffix
});

test("fromApiResponse falls back to confidence (0-1) and is_shopify", () => {
  const r = fromApiResponse({ is_shopify: true, confidence: 0.7 });
  assert.equal(r.confidence, 70);
  assert.equal(r.verdict, "yes");
  assert.deepEqual(r.hits, []);
  assert.equal(fromApiResponse(null).verdict, "no");
});

test("detailTiles shows only returned fields", () => {
  assert.deepEqual(detailTiles(STORE).map((t) => t.k), ["Theme", "Shopify Plus", "Currency", "Catalog"]);
  assert.equal(detailTiles(STORE)[0].title, "Dawn (theme store #887)");
  assert.equal(detailTiles(STORE)[3].v, "Public, 1+ product");
  assert.deepEqual(detailTiles({ theme: null, plus: false, currency: null, product_count: null }), []);
  assert.deepEqual(detailTiles({ currency: "rupees", theme: "  " }), []);
  assert.equal(detailTiles({ product_count: 0 })[0].v, "Public, empty");
});

test("retryAfterSec prefers the body, then a numeric header, and clamps", () => {
  assert.equal(retryAfterSec({ error: { retry_after: 42 } }, "60"), 42);
  assert.equal(retryAfterSec({ error: {} }, "17"), 17);
  assert.equal(retryAfterSec(null, null), null);
  assert.equal(retryAfterSec({ error: { retry_after: 0 } }, "Wed, 21 Oct 2026 07:28:00 GMT"), null);
  assert.equal(retryAfterSec({ error: { retry_after: 1.2 } }), 2);
  assert.equal(retryAfterSec({ error: { retry_after: 99999 } }), 3600);
});

test("verdictLabel", () => {
  assert.equal(verdictLabel("yes"), "Shopify");
  assert.equal(verdictLabel("blocked"), "Blocked");
  assert.equal(verdictLabel("zzz"), "");
});
