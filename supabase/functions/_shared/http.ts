// CORS + JSON helpers + safe error shaping. Never leak internals to clients.
import { originPolicy, allowedOrigin } from "../../../shared/net/cors.mjs";

// Allow-Origin is set per request by withCors(): fail-closed against an allowlist
// (ALLOWED_ORIGIN, comma-separated, or the defaults in shared/net/cors.mjs).
export const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-manage-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const ORIGINS = originPolicy(Deno.env.get("ALLOWED_ORIGIN"));

/** Wrap a handler so every response carries the right Allow-Origin (or none). */
export function withCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    const allow = allowedOrigin(req.headers.get("origin"), ORIGINS);
    const headers = new Headers(res.headers);
    headers.delete("Access-Control-Allow-Origin");
    if (allow) headers.set("Access-Control-Allow-Origin", allow);
    if (allow !== "*") headers.append("Vary", "Origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return null;
}

export function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

// Public-facing error: a short code + message, plus a correlation id for logs.
export function fail(status: number, code: string, message: string): Response {
  const ref = crypto.randomUUID().slice(0, 8);
  return json({ error: { code, message, ref } }, status);
}

// Redact PII before logging.
export function redact(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "string") {
    return v
      .replace(/([\w.+-])[\w.+-]*(@[\w.-]+)/g, "$1***$2")
      .replace(/\+?\d[\d\s-]{6,}\d/g, (m) => m.slice(0, 3) + "***" + m.slice(-2));
  }
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = /email|phone|token|authorization|key|secret/i.test(k) ? "[redacted]" : redact(val);
    }
    return out;
  }
  return v;
}

export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...(redact(data) as object) }));
}
