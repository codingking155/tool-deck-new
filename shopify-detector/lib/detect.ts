import { DetectionError } from "./detect/errors";
import { fetchPage as defaultFetchPage, type FetchedPage, type PageFetcher } from "./detect/http";
import { normalizeInput } from "./detect/normalize";
import { isCartJson, isProductsJson, sampleHeaders, scoreSignals, SHOPIFY_THRESHOLD, toConfidence } from "./detect/signals";
import { assertPublicHost, type Resolver } from "./detect/ssrf";

export { DetectionError } from "./detect/errors";
export type { DetectionErrorCode, UnreachableReason } from "./detect/errors";
export { normalizeInput } from "./detect/normalize";

export interface DetectionResult {
  input_url: string;
  final_url: string;
  is_shopify: boolean;
  confidence: number;
  shop_domain: string | null;
  detected_signals: string[];
  headers_sample: Record<string, string>;
  elapsed_ms: number;
}

export interface DetectDeps {
  fetchPage: PageFetcher;
  resolve?: Resolver;
}

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_MAX_BYTES = 256 * 1024;
const PROBE_WEIGHT = 0.3;

const RETRY_OVER_HTTP = new Set(["refused", "tls", "network"]);

async function fetchHomepage(host: string, fetchPage: PageFetcher): Promise<FetchedPage> {
  const opts = { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: PAGE_MAX_BYTES };
  try {
    return await fetchPage(`https://${host}/`, opts);
  } catch (err) {
    if (err instanceof DetectionError && err.code === "unreachable" && err.reason && RETRY_OVER_HTTP.has(err.reason)) {
      try {
        return await fetchPage(`http://${host}/`, opts);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

async function probeEndpoints(origin: string, fetchPage: PageFetcher): Promise<string | null> {
  const probes: [path: string, valid: (d: unknown) => boolean][] = [
    ["/cart.js", isCartJson],
    ["/products.json?limit=1", isProductsJson],
  ];
  for (const [path, valid] of probes) {
    try {
      const res = await fetchPage(new URL(path, origin).toString(), {
        timeoutMs: PROBE_TIMEOUT_MS,
        maxBytes: PROBE_MAX_BYTES,
        accept: "application/json",
        maxRedirects: 2,
      });
      if (res.status === 200 && valid(JSON.parse(res.body))) return `endpoint:${path.split("?")[0]}`;
    } catch {
      // A failed probe is just an absent signal.
    }
  }
  return null;
}

function looksBlocked(page: FetchedPage): boolean {
  if (page.headers.get("cf-mitigated") === "challenge") return true;
  if ([401, 403, 429].includes(page.status)) return true;
  return /<title>\s*(?:Just a moment|Attention Required|Access denied)/i.test(page.body.slice(0, 20_000));
}

export async function detectShopify(input: string, deps: Partial<DetectDeps> = {}): Promise<DetectionResult> {
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const target = normalizeInput(input);
  await assertPublicHost(target.host, deps.resolve);

  const started = performance.now();
  const page = await fetchHomepage(target.host, fetchPage);
  const elapsed = Math.round(performance.now() - started);

  const { signals, score: baseScore, shopDomain } = scoreSignals({
    hopHeaders: page.hopHeaders,
    setCookies: page.setCookies,
    html: page.body,
  });

  let score = baseScore;
  if (score < SHOPIFY_THRESHOLD) {
    const endpoint = await probeEndpoints(new URL(page.finalUrl).origin, fetchPage);
    if (endpoint) {
      signals.push(endpoint);
      score += PROBE_WEIGHT;
    }
  }

  if (score === 0 && looksBlocked(page)) {
    throw new DetectionError("unreachable", "The site blocked our check (bot protection or access restrictions).", "blocked");
  }
  if (score === 0 && page.status >= 500) {
    throw new DetectionError("unreachable", `The site responded with a server error (HTTP ${page.status}).`, "http_error");
  }

  const confidence = toConfidence(score);
  const isShopify = confidence >= SHOPIFY_THRESHOLD;

  return {
    input_url: input.trim(),
    final_url: page.finalUrl,
    is_shopify: isShopify,
    confidence,
    shop_domain: isShopify ? shopDomain : null,
    detected_signals: signals,
    headers_sample: sampleHeaders(page.headers),
    elapsed_ms: elapsed,
  };
}
