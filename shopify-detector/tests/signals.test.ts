import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractShopDomain, sampleHeaders, scoreSignals, toConfidence } from "@/lib/detect/signals";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const headers = (init: Record<string, string> = {}) => new Headers(init);

describe("scoreSignals", () => {
  it("scores a Shopify theme page above the threshold with body signals", () => {
    const r = scoreSignals({ hopHeaders: [headers()], setCookies: [], html: fixture("shopify.html") });
    expect(r.signals).toEqual(
      expect.arrayContaining([
        "body:window.Shopify",
        "body:Shopify.shop",
        "body:Shopify.theme",
        "body:cdn.shopify.com",
        "body:myshopify.com",
        "body:shopify-digital-wallet",
        "body:/cdn/shop/",
        "body:Shopify.routes",
        "body:shopify-features",
        "body:ShopifyAnalytics",
      ]),
    );
    expect(toConfidence(r.score)).toBe(0.95);
    expect(r.shopDomain).toBe("demo-outfitters.myshopify.com");
  });

  it("scores Shopify response headers and cookies", () => {
    const r = scoreSignals({
      hopHeaders: [
        headers({ "x-shopid": "123", "x-sorting-hat-podid": "4", "x-sorting-hat-shopid": "123", "powered-by": "Shopify" }),
      ],
      setCookies: ["_shopify_y=abc; Path=/", "cart_currency=USD; Path=/", "other=1"],
      html: "",
    });
    expect(r.signals).toEqual([
      "header:x-shopid",
      "header:x-sorting-hat-podid",
      "header:x-sorting-hat-shopid",
      "header:powered-by",
      "header:set-cookie:_shopify_y",
      "header:set-cookie:cart_currency",
    ]);
    // 0.35 + 0.3 + 0.35 + 0.2 — each rule counts once even with several matching names
    expect(r.score).toBeCloseTo(1.2);
    expect(toConfidence(r.score)).toBe(0.95);
  });

  it("counts headers seen on a redirect hop", () => {
    const r = scoreSignals({ hopHeaders: [headers({ "x-shopify-stage": "production" }), headers()], setCookies: [], html: "" });
    expect(r.signals).toEqual(["header:x-shopify-stage"]);
  });

  it("ignores powered-by values that aren't Shopify", () => {
    const r = scoreSignals({ hopHeaders: [headers({ "powered-by": "Express" })], setCookies: [], html: "" });
    expect(r.score).toBe(0);
  });

  it("finds nothing on a WooCommerce page", () => {
    const r = scoreSignals({ hopHeaders: [headers({ server: "nginx" })], setCookies: [], html: fixture("non-shopify.html") });
    expect(r).toEqual({ signals: [], score: 0, shopDomain: null });
  });

  it("does not flag an article that merely mentions Shopify markers in visible text", () => {
    const r = scoreSignals({ hopHeaders: [headers()], setCookies: [], html: fixture("mentions-shopify.html") });
    expect(r.signals).toEqual([]);
    expect(r.shopDomain).toBeNull();
  });
});

describe("toConfidence", () => {
  it.each([
    [0, 0],
    [0.45, 0.45],
    [0.555, 0.56],
    [3, 0.95],
    [-1, 0],
  ])("%s → %s", (score, expected) => {
    expect(toConfidence(score)).toBe(expected);
  });
});

describe("extractShopDomain", () => {
  it("prefers an explicit Shopify.shop assignment", () => {
    expect(extractShopDomain('a.myshopify.com a.myshopify.com Shopify.shop = "real-store.myshopify.com"')).toBe("real-store.myshopify.com");
  });

  it("falls back to the most frequent myshopify domain", () => {
    expect(extractShopDomain("x.myshopify.com y.myshopify.com y.myshopify.com")).toBe("y.myshopify.com");
  });
});

describe("sampleHeaders", () => {
  it("keeps only the safe allowlist", () => {
    const h = headers({ server: "cloudflare", "set-cookie": "secret=1", "x-shopid": "9", authorization: "x", "content-type": "text/html" });
    expect(sampleHeaders(h)).toEqual({ server: "cloudflare", "content-type": "text/html", "x-shopid": "9" });
  });
});
