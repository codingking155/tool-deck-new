import { log } from "../_shared/http.ts";
import { clientIp } from "../_shared/ratelimit.ts";
import { sharedRateLimit } from "../_shared/sharedRateLimit.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseCspReports, MAX_BODY_BYTES } from "../../../shared/cspReport/index.mjs";

// Receives CSP violation reports from browsers (vercel.json: report-uri + report-to / Reporting-Endpoints).
// - Browsers send these without a JWT, so it's deployed with --no-verify-jwt.
// - Per-IP limit (30/min, shared across instances); over the limit, reports are dropped silently.
// - Only reduced fields are stored (see shared/cspReport): no query strings, script samples or tool args.
// - Always answers 204 with no body: browsers ignore the response, and nothing is echoed back.

const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type",
    } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return done();

  const rl = await sharedRateLimit("csp", clientIp(req), 30, 60);
  if (!rl.ok) return done();

  let text = "";
  try { text = await req.text(); } catch { return done(); }
  const reports = parseCspReports(text, req.headers.get("content-type") ?? "");
  if (!reports.length) return done();

  const { error } = await serviceClient().rpc("csp_report_add", { p_rows: reports });
  if (error) log("csp_report_store_failed", { message: error.message });
  return done();
});
