import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeShopify, buildReport, SHOPIFY_SIGNALS } from "../src/lib/shopify.js";

/* ── realistic fixtures ─────────────────────────────────────────────── */

const DAWN_STORE = `<!doctype html><html><head>
<link rel="preconnect" href="https://cdn.shopify.com">
<link href="https://cdn.shopify.com/s/files/1/0629/theme.css" rel="stylesheet">
<script>window.Shopify = window.Shopify || {};
Shopify.theme = {"name":"Dawn","id":128,"theme_store_id":887};
Shopify.shop = "acme-blr.myshopify.com";
Shopify.currency = {"active":"INR","rate":"1.0"};
window.ShopifyAnalytics = window.ShopifyAnalytics || {}; var trekkie = [];
</script></head><body>
<div id="shopify-section-header" class="shopify-section"></div>
<form action="/cart/add" method="post"></form>
<script src="/cart.js"></script>
<shop-pay-wallet-button></shop-pay-wallet-button>
</body></html>`;

const PLUS_STORE = DAWN_STORE.replace("</body>", `<script src="https://cdn.shopify.com/shopifycloud/checkout/x.js"></script></body>`);

const HEADLESS = `<!doctype html><html><body>
<script>fetch("https://acme-hydro.myshopify.com/api/2024-01/graphql", {headers:{"x-shopify-storefront-access-token":"abc"}})</script>
</body></html>`;

const WOOCOMMERCE = `<!doctype html><html><head>
<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
<script src="/wp-includes/js/jquery/jquery.min.js"></script>
</head><body class="woocommerce-page"><div class="cart-contents"></div></body></html>`;

const NEWS_ARTICLE = `<!doctype html><html><body>
<article><p>Shopify's CDN, cdn.shopify.com, served 1B requests. Merchants get a
myshopify.com subdomain when they sign up, wrote the reporter.</p></article>
</body></html>`;

/* ── verdicts ───────────────────────────────────────────────────────── */

test("full Dawn storefront → yes with high confidence and rich extraction", () => {
  const r = analyzeShopify(DAWN_STORE, "https://acmestore.in");
  assert.equal(r.verdict, "yes");
  assert.ok(r.confidence >= 90);
  assert.equal(r.shopDomain, "acme-blr.myshopify.com");
  assert.equal(r.theme, "Dawn");
  assert.equal(r.currency, "INR");
  assert.equal(r.plus, false);
  assert.ok(r.hits.length >= 6);
});

test("Plus markers set the flag without inflating the score", () => {
  const base = analyzeShopify(DAWN_STORE, "https://x.in");
  const plus = analyzeShopify(PLUS_STORE, "https://x.in");
  assert.equal(plus.plus, true);
  assert.equal(plus.confidence, base.confidence); // bonus signal is weight 0
});

test("myshopify.com URL alone is decisive without any HTML", () => {
  const r = analyzeShopify("", "https://acme.myshopify.com");
  assert.equal(r.verdict, "yes");
  assert.ok(r.confidence >= 95, "a myshopify.com hostname is conclusive by definition");
});

test("headless storefront lands in uncertain, not no", () => {
  const r = analyzeShopify(HEADLESS, "https://acmehydro.com");
  assert.equal(r.verdict, "uncertain");
  assert.equal(r.shopDomain, "acme-hydro.myshopify.com");
});

test("WooCommerce store → no, zero hits", () => {
  const r = analyzeShopify(WOOCOMMERCE, "https://woostore.in");
  assert.equal(r.verdict, "no");
  assert.equal(r.hits.length, 0);
  assert.equal(r.shopDomain, null);
});

test("KNOWN LIMITATION: prose mentioning Shopify infrastructure can score", () => {
  // A news article that merely *mentions* cdn.shopify.com / myshopify.com
  // matches the substring signals. Documenting current behavior honestly:
  const r = analyzeShopify(NEWS_ARTICLE, "https://technews.in");
  assert.ok(r.confidence > 0); // it does score — see review notes
});

/* ── shopDomain extraction hygiene ──────────────────────────────────── */

test("infrastructure subdomains are never reported as the shop identity", () => {
  for (const host of ["cdn", "checkout", "admin", "api", "help", "apps", "accounts"]) {
    const r = analyzeShopify(`<img src="https://${host}.myshopify.com/x.png">`, "https://x.in");
    assert.equal(r.shopDomain, null, `${host}.myshopify.com must be filtered`);
  }
});

test("shop domain is lowercased and picked from URL or HTML", () => {
  assert.equal(analyzeShopify("", "https://ACME-BLR.myshopify.com").shopDomain, "acme-blr.myshopify.com");
});

/* ── scoring properties ─────────────────────────────────────────────── */

test("confidence is capped at 98 — detection is never claimed as certain", () => {
  const everything = SHOPIFY_SIGNALS.map((s) => s.re.source.replace(/\\|\(|\)|\||\[.*?\]|\+|\?|\{.*?\}|\^|\$/g, " ")).join(" ")
    + " cdn.shopify.com window.Shopify a.myshopify.com ShopifyAnalytics shopify-section /checkouts/ shop-pay storefront-access-token";
  const r = analyzeShopify(everything, "https://a.myshopify.com");
  assert.ok(r.confidence <= 98);
});

test("verdict thresholds: 55+ yes, 25–54 uncertain, <25 no", () => {
  assert.equal(analyzeShopify(`<b>window.Shopify</b><i>cdn.shopify.com</i>`, "").verdict, "yes"); // 25+30
  assert.equal(analyzeShopify(`<b>window.Shopify</b>`, "").verdict, "uncertain"); // 25
  assert.equal(analyzeShopify(`<b>shopify-section</b>`, "").verdict, "no"); // 10
});

/* ── report ─────────────────────────────────────────────────────────── */

test("copy report contains verdict, domain, theme, signals and date", () => {
  const r = analyzeShopify(DAWN_STORE, "https://acmestore.in");
  const rep = buildReport(r, "https://acmestore.in", 412);
  assert.match(rep, /Shopify store detected \(\d+% confidence\)/);
  assert.match(rep, /Shop domain: acme-blr\.myshopify\.com/);
  assert.match(rep, /Theme: Dawn/);
  assert.match(rep, /Response time: 412 ms/);
  assert.match(rep, /✓ .*cdn\.shopify\.com/);
  assert.match(rep, /\d{4}-\d{2}-\d{2}$/m);
});

test("report omits absent fields instead of printing null", () => {
  const r = analyzeShopify(WOOCOMMERCE, "https://woostore.in");
  const rep = buildReport(r, "https://woostore.in", null);
  assert.doesNotMatch(rep, /null|undefined|Shop domain|Theme:/);
});

/* ── header signals (server API path) ───────────────────────────────── */

import { applyHeaderSignals } from "../src/lib/shopify.js";

test("header evidence alone yields a confident yes (headless-proof)", () => {
  const base = analyzeShopify("", "https://acmehydro.com"); // empty body, no signals
  const r = applyHeaderSignals(base, { "x-shopify-stage": "production", "x-sorting-hat-podid": "123" });
  assert.equal(r.verdict, "yes");
  assert.ok(r.confidence >= 90);
  assert.equal(r.headerEvidence, true);
});

test("powered-by header only counts when the value says Shopify", () => {
  const base = analyzeShopify("", "https://x.in");
  assert.equal(applyHeaderSignals(base, { "powered-by": "WP Engine" }).confidence, 0);
  assert.ok(applyHeaderSignals(base, { "powered-by": "Shopify" }).confidence >= 50);
});

test("header + HTML evidence still capped at 98", () => {
  const r = applyHeaderSignals(
    analyzeShopify(DAWN_STORE, "https://x.in"),
    { "x-shopify-stage": "production", "x-shopid": "9", "x-shardid": "1", "powered-by": "Shopify" },
  );
  assert.equal(r.confidence, 98);
});
