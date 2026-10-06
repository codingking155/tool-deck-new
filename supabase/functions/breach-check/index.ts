import { preflight, json, fail, log } from "../_shared/http.ts";
import { rateLimit, clientIp } from "../_shared/ratelimit.ts";
import { isValidEmail, parseXonAnalytics, isXonNotFound, summarize } from "../../../shared/breachCore/index.mjs";

// POST { email } -> { email_checked, breaches[], summary } using XposedOrNot's free API.
// - Email goes in the POST body (never a URL) and is never logged; http.ts redacts it anyway.
// - Only a genuine 404 "Not found" from the provider means "no breaches". Any other failure is
//   reported as unavailable — never as an all-clear.
// - Per-IP limit (8/min) so the endpoint can't be used to enumerate other people's exposure at scale.

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");

  const rl = rateLimit(`breach:${clientIp(req)}`, 8, 60_000);
  if (!rl.ok) return fail(429, "rate_limited", `Too many checks — try again in ${rl.retryAfter}s.`);

  let email = "";
  try { email = String((await req.json())?.email ?? "").trim().toLowerCase(); } catch { /* falls through */ }
  if (!isValidEmail(email)) return fail(400, "bad_email", "Enter a valid email address.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`, {
      signal: ctrl.signal, headers: { "User-Agent": "ToolDeck-breach-check/1.0", Accept: "application/json" },
    });
    const payload = await r.json().catch(() => null);

    if (isXonNotFound(r.status, payload)) {
      return json({ breaches: [], summary: summarize([]), source: "XposedOrNot" }, 200, { "Cache-Control": "no-store" });
    }
    if (r.status === 429) return fail(503, "provider_busy", "The breach database is busy right now. Try again in a minute.");
    if (!r.ok) { log("breach_provider_status", { status: r.status }); return fail(502, "provider_error", "Unable to check right now."); }

    const breaches = parseXonAnalytics(payload);
    if (!breaches) { log("breach_provider_shape"); return fail(502, "provider_error", "Unable to check right now."); }
    return json({ breaches, summary: summarize(breaches), source: "XposedOrNot" }, 200, { "Cache-Control": "no-store" });
  } catch {
    return fail(502, "provider_unreachable", "Unable to check right now.");
  } finally {
    clearTimeout(timer);
  }
});
