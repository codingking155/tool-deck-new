import { DetectionError } from "./detect/errors";
import type { LimitResult } from "./ratelimit";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...headers } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function rateLimitHeaders(r: LimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(Math.max(0, r.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(r.reset / 1000)),
  };
}

export function rateLimited(r: LimitResult): Response {
  const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
  return json(
    { error: "rate_limited", message: `Too many requests. Try again in ${retryAfter}s.`, retry_after: retryAfter },
    429,
    { ...rateLimitHeaders(r), "Retry-After": String(retryAfter) },
  );
}

export function errorBody(err: unknown): { status: number; body: { error: string; message: string; reason?: string } } {
  if (err instanceof DetectionError) {
    return { status: err.status, body: { error: err.code, message: err.message, ...(err.reason && { reason: err.reason }) } };
  }
  console.error("unexpected check failure", err);
  return { status: 500, body: { error: "internal", message: "Something went wrong on our side. Please try again." } };
}

/** Vercel overwrites x-forwarded-for with the real client address, so the first hop is trustworthy there. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "anonymous";
}
