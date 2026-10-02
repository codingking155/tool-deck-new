import { Agent, fetch as undiciFetch } from "undici";
import { DetectionError } from "./errors";
import { safeLookup } from "./ssrf";

export interface HeaderBag {
  get(name: string): string | null;
}

export interface FetchedPage {
  status: number;
  finalUrl: string;
  /** Headers of the final response. */
  headers: HeaderBag;
  /** Headers of every hop, redirects included — Shopify often sets x-shopid on the redirect itself. */
  hopHeaders: HeaderBag[];
  setCookies: string[];
  body: string;
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  accept?: string;
  maxRedirects?: number;
}

export type PageFetcher = (url: string, opts: FetchOptions) => Promise<FetchedPage>;

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const agent = new Agent({
  connect: { lookup: safeLookup as never, timeout: 5_000 },
  headersTimeout: 8_000,
  bodyTimeout: 8_000,
  keepAliveTimeout: 2_000,
});

async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength + received > maxBytes ? value.subarray(0, maxBytes - received) : value;
      received += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out + decoder.decode();
}

function mapError(err: unknown, url: string, signal: AbortSignal): DetectionError {
  if (err instanceof DetectionError) return err;
  const host = new URL(url).hostname;
  if (signal.aborted) return new DetectionError("timeout", `${host} took too long to respond.`);
  const cause = (err as { cause?: NodeJS.ErrnoException }).cause ?? (err as NodeJS.ErrnoException);
  const code = cause?.code ?? "";
  if (code === "EBLOCKEDADDR") {
    return new DetectionError("invalid_url", "That site redirects to a private or reserved network address.");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new DetectionError("unreachable", `We couldn't find ${host} — check the domain for typos.`, "dns");
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT") {
    return new DetectionError("timeout", `${host} took too long to respond.`);
  }
  if (code === "ECONNREFUSED") return new DetectionError("unreachable", `${host} refused the connection.`, "refused");
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate|ssl|tls/i.test(cause?.message ?? "")) {
    return new DetectionError("unreachable", `${host} has an invalid HTTPS certificate.`, "tls");
  }
  return new DetectionError("unreachable", `We couldn't connect to ${host}.`, "network");
}

/** Fetches a URL with SSRF-safe DNS, manual redirect validation, a hard deadline and a body cap. */
export const fetchPage: PageFetcher = async (url, { timeoutMs, maxBytes, accept, maxRedirects = 5 }) => {
  const signal = AbortSignal.timeout(timeoutMs);
  const hopHeaders: HeaderBag[] = [];
  const setCookies: string[] = [];
  let current = url;

  try {
    for (let hop = 0; ; hop++) {
      const res = await undiciFetch(current, {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      hopHeaders.push(res.headers);
      setCookies.push(...res.headers.getSetCookie());

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        res.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new DetectionError("unreachable", "The site redirected too many times.", "http_error");
        const next = new URL(location, current);
        if (next.protocol !== "https:" && next.protocol !== "http:") {
          throw new DetectionError("unreachable", "The site redirected to an unsupported address.", "http_error");
        }
        if (next.port && next.port !== "80" && next.port !== "443") {
          throw new DetectionError("unreachable", "The site redirected to a non-standard port.", "http_error");
        }
        next.username = "";
        next.password = "";
        current = next.toString();
        continue;
      }

      const body = await readCapped(res.body as ReadableStream<Uint8Array> | null, maxBytes);
      return { status: res.status, finalUrl: current, headers: res.headers, hopHeaders, setCookies, body };
    }
  } catch (err) {
    throw mapError(err, current, signal);
  }
};
