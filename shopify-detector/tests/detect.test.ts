import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectShopify } from "@/lib/detect";
import { DetectionError } from "@/lib/detect/errors";
import type { FetchedPage, PageFetcher } from "@/lib/detect/http";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const publicDns = async () => [{ address: "23.227.38.65", family: 4 }];

function page(url: string, body: string, init: { status?: number; headers?: Record<string, string> } = {}): FetchedPage {
  const h = new Headers(init.headers);
  return { status: init.status ?? 200, finalUrl: url, headers: h, hopHeaders: [h], setCookies: [], body };
}

function fakeFetcher(routes: Record<string, FetchedPage | DetectionError>): PageFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fn: PageFetcher = async (url) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) return page(url, "not found", { status: 404 });
    if (hit instanceof DetectionError) throw hit;
    return hit;
  };
  return Object.assign(fn, { calls });
}

describe("detectShopify", () => {
  it("detects a Shopify store without probing endpoints", async () => {
    const fetchPage = fakeFetcher({
      "https://demo.example/": page("https://www.demo.example/", fixture("shopify.html"), { headers: { server: "cloudflare", "x-shopid": "1" } }),
    });
    const r = await detectShopify("demo.example", { fetchPage, resolve: publicDns });
    expect(r).toMatchObject({
      input_url: "demo.example",
      final_url: "https://www.demo.example/",
      is_shopify: true,
      confidence: 0.95,
      shop_domain: "demo-outfitters.myshopify.com",
      headers_sample: { server: "cloudflare", "x-shopid": "1" },
    });
    expect(r.detected_signals[0]).toBe("header:x-shopid");
    expect(fetchPage.calls).toEqual(["https://demo.example/"]);
  });

  it("probes /cart.js then /products.json when the score is low, and reports non-Shopify", async () => {
    const fetchPage = fakeFetcher({ "https://acme.example/": page("https://acme.example/", fixture("non-shopify.html")) });
    const r = await detectShopify("https://acme.example/some/path", { fetchPage, resolve: publicDns });
    expect(r).toMatchObject({ is_shopify: false, confidence: 0, shop_domain: null, detected_signals: [] });
    expect(fetchPage.calls).toEqual(["https://acme.example/", "https://acme.example/cart.js", "https://acme.example/products.json?limit=1"]);
  });

  it("adds the endpoint signal when /cart.js returns a Shopify cart", async () => {
    const weak = '<html><head><link rel="preconnect" href="https://cdn.shopify.com"></head></html>';
    const fetchPage = fakeFetcher({
      "https://headless.example/": page("https://headless.example/", weak),
      "https://headless.example/cart.js": page("https://headless.example/cart.js", JSON.stringify({ token: "t", items: [], item_count: 0 })),
    });
    const r = await detectShopify("headless.example", { fetchPage, resolve: publicDns });
    expect(r.detected_signals).toEqual(["body:cdn.shopify.com", "endpoint:/cart.js"]);
    expect(r.confidence).toBe(0.55);
    expect(r.is_shopify).toBe(true);
  });

  it("retries over http when https is refused", async () => {
    const fetchPage = fakeFetcher({
      "https://old.example/": new DetectionError("unreachable", "refused", "refused"),
      "http://old.example/": page("http://old.example/", fixture("shopify.html")),
    });
    const r = await detectShopify("old.example", { fetchPage, resolve: publicDns });
    expect(r.final_url).toBe("http://old.example/");
    expect(r.is_shopify).toBe(true);
  });

  it("does not retry over http after a timeout", async () => {
    const fetchPage = fakeFetcher({ "https://slow.example/": new DetectionError("timeout", "slow") });
    await expect(detectShopify("slow.example", { fetchPage, resolve: publicDns })).rejects.toMatchObject({ code: "timeout", status: 504 });
    expect(fetchPage.calls).toEqual(["https://slow.example/"]);
  });

  it("reports a bot-protection block as unreachable/blocked", async () => {
    const challenge = "<html><head><title>Just a moment...</title></head></html>";
    const fetchPage = fakeFetcher({ "https://guarded.example/": page("https://guarded.example/", challenge, { status: 403 }) });
    await expect(detectShopify("guarded.example", { fetchPage, resolve: publicDns })).rejects.toMatchObject({
      code: "unreachable",
      reason: "blocked",
    });
  });

  it("still detects a Shopify store that answers 403 with Shopify headers", async () => {
    const fetchPage = fakeFetcher({
      "https://locked.example/": page("https://locked.example/", "", { status: 403, headers: { "x-shopid": "1", "x-shopify-stage": "production" } }),
    });
    const r = await detectShopify("locked.example", { fetchPage, resolve: publicDns });
    expect(r.is_shopify).toBe(true);
  });

  it("rejects hosts resolving to private addresses before fetching", async () => {
    const fetchPage = fakeFetcher({});
    await expect(
      detectShopify("internal.example", { fetchPage, resolve: async () => [{ address: "10.1.2.3", family: 4 }] }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    expect(fetchPage.calls).toEqual([]);
  });
});
