import type { NextRequest } from "next/server";
import { clientIp, errorBody, json, preflight, rateLimited, rateLimitHeaders } from "@/lib/api";
import { runCheck } from "@/lib/check-service";
import { checkRateLimit } from "@/lib/ratelimit";

export const maxDuration = 30;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const limit = await checkRateLimit(clientIp(req));
  if (!limit.success) return rateLimited(limit);
  const headers = rateLimitHeaders(limit);

  const url = req.nextUrl.searchParams.get("url");
  if (!url?.trim()) {
    return json({ error: "invalid_url", message: "Pass the website to check as ?url=example.com" }, 400, headers);
  }

  try {
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    return json(await runCheck(url, { fresh }), 200, headers);
  } catch (err) {
    const { status, body } = errorBody(err);
    return json(body, status, headers);
  }
}
