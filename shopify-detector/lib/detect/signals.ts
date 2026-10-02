import * as cheerio from "cheerio";
import type { HeaderBag } from "./http";

export const SHOPIFY_THRESHOLD = 0.5;
export const MAX_CONFIDENCE = 0.95;

interface HeaderRule {
  weight: number;
  names: string[];
  value?: RegExp;
}

const HEADER_RULES: HeaderRule[] = [
  { weight: 0.35, names: ["x-shopid"] },
  { weight: 0.35, names: ["x-shopify-stage"] },
  { weight: 0.3, names: ["x-sorting-hat-podid", "x-sorting-hat-shopid"] },
  { weight: 0.35, names: ["powered-by"], value: /shopify/i },
  { weight: 0.2, names: ["x-shardid"] },
];

const COOKIE_WEIGHT = 0.2;
const SHOPIFY_COOKIES = ["_shopify_y", "_shopify_s", "cart_currency", "secure_customer_sig"];

interface BodyRule {
  weight: number;
  tests: [name: string, test: RegExp | (($: cheerio.CheerioAPI) => boolean)][];
}

const BODY_RULES: BodyRule[] = [
  { weight: 0.3, tests: [["window.Shopify", /window\.Shopify\b/], ["Shopify.shop", /Shopify\.shop\s*=/]] },
  { weight: 0.25, tests: [["Shopify.theme", /Shopify\.theme\b/]] },
  { weight: 0.25, tests: [["cdn.shopify.com", /cdn\.shopify\.com/i]] },
  { weight: 0.2, tests: [["myshopify.com", /[a-z0-9-]\.myshopify\.com/i]] },
  { weight: 0.2, tests: [["shopify-digital-wallet", ($) => $('meta[name="shopify-digital-wallet"]').length > 0]] },
  { weight: 0.2, tests: [["/cdn/shop/", /\/cdn\/shop\//]] },
  { weight: 0.15, tests: [["Shopify.routes", /Shopify\.routes\b/]] },
  { weight: 0.15, tests: [["shopify-features", ($) => $("script#shopify-features, script[data-shopify-features]").length > 0]] },
  { weight: 0.15, tests: [["ShopifyAnalytics", /ShopifyAnalytics\b/]] },
  { weight: 0.1, tests: [["/checkouts/", /\/checkouts\//], ["shop.app", /\bshop\.app\b/]] },
];

export const SAMPLE_HEADERS = [
  "server",
  "content-type",
  "cf-ray",
  "x-shopid",
  "x-shopify-stage",
  "x-sorting-hat-podid",
  "x-sorting-hat-shopid",
  "powered-by",
];

export interface SignalInput {
  hopHeaders: HeaderBag[];
  setCookies: string[];
  html: string;
}

export interface SignalResult {
  signals: string[];
  score: number;
  shopDomain: string | null;
}

/**
 * The parts of a page that only a platform would put there: script and style
 * bodies plus attribute values. Visible text is excluded, so an article that
 * merely mentions "cdn.shopify.com" doesn't read as a Shopify store.
 */
function codeSurface($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  $("script, style").each((_, el) => {
    parts.push($(el).text());
  });
  $("*").each((_, el) => {
    if ("attribs" in el) for (const v of Object.values(el.attribs)) parts.push(v);
  });
  return parts.join("\n");
}

export function extractShopDomain(html: string): string | null {
  const assigned = html.match(/Shopify\.shop\s*=\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i);
  if (assigned) return assigned[1].toLowerCase();

  const counts = new Map<string, number>();
  for (const m of html.matchAll(/([a-z0-9][a-z0-9-]*)\.myshopify\.com/gi)) {
    const d = `${m[1].toLowerCase()}.myshopify.com`;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) [best, bestCount] = [d, n];
  }
  return best;
}

function cookieName(setCookie: string): string {
  return setCookie.split("=", 1)[0].trim();
}

export function scoreSignals({ hopHeaders, setCookies, html }: SignalInput): SignalResult {
  const signals: string[] = [];
  let score = 0;

  for (const rule of HEADER_RULES) {
    const hits = rule.names.filter((name) =>
      hopHeaders.some((h) => {
        const v = h.get(name);
        return v !== null && (!rule.value || rule.value.test(v));
      }),
    );
    if (hits.length) {
      score += rule.weight;
      signals.push(...hits.map((n) => `header:${n}`));
    }
  }

  const cookieNames = new Set(setCookies.map(cookieName));
  const cookieHits = SHOPIFY_COOKIES.filter((c) => cookieNames.has(c));
  if (cookieHits.length) {
    score += COOKIE_WEIGHT;
    signals.push(...cookieHits.map((c) => `header:set-cookie:${c}`));
  }

  let shopDomain: string | null = null;
  if (html) {
    const $ = cheerio.load(html);
    const surface = codeSurface($);
    for (const rule of BODY_RULES) {
      const hits = rule.tests.filter(([, t]) => (t instanceof RegExp ? t.test(surface) : t($))).map(([n]) => n);
      if (hits.length) {
        score += rule.weight;
        signals.push(...hits.map((n) => `body:${n}`));
      }
    }
    shopDomain = extractShopDomain(surface);
  }

  return { signals, score, shopDomain };
}

export function toConfidence(score: number): number {
  return Math.round(Math.min(Math.max(score, 0), MAX_CONFIDENCE) * 100) / 100;
}

export function sampleHeaders(headers: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SAMPLE_HEADERS) {
    const v = headers.get(name);
    if (v !== null) out[name] = v.slice(0, 200);
  }
  return out;
}

export function isCartJson(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.token === "string" && Array.isArray(d.items) && typeof d.item_count === "number";
}

export function isProductsJson(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  return Array.isArray((data as Record<string, unknown>).products);
}
