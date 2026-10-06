// Origin allowlist for the Edge Functions' CORS headers.
//
// Fail-closed: a browser origin that is not on the list gets no
// Access-Control-Allow-Origin header at all, so the browser refuses to hand the
// response to that page. Server-to-server callers (cron, Zapier) send no Origin
// and are unaffected.
//
// ALLOWED_ORIGIN (comma-separated) replaces the defaults. An entry may use `*`
// for one or more DNS-label characters ("https://*.example.com"); a lone `*`
// opts back into allowing every origin.
//
// Pure and dependency-free so it runs identically in Deno and Node.

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://tooldeck.in",
  "https://www.tooldeck.in",
  "https://tool-deck-new.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

// Vercel preview deployments of this project.
export const DEFAULT_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+-codingking155-9340s-projects\.vercel\.app$/,
  /^https:\/\/[a-z0-9-]+-zoko-f348\.vercel\.app$/,
];

const escape = (s) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");

/** Build the policy from the raw ALLOWED_ORIGIN value (undefined/empty → defaults). */
export function originPolicy(raw) {
  const entries = String(raw ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  if (!entries.length) return { any: false, exact: new Set(DEFAULT_ALLOWED_ORIGINS), patterns: DEFAULT_ORIGIN_PATTERNS };
  if (entries.includes("*")) return { any: true, exact: new Set(), patterns: [] };
  const exact = new Set(entries.filter((e) => !e.includes("*")));
  const patterns = entries.filter((e) => e.includes("*"))
    .map((e) => new RegExp("^" + e.split("*").map(escape).join("[a-z0-9-]+") + "$"));
  return { any: false, exact, patterns };
}

/** Value for Access-Control-Allow-Origin, or null when the origin is not allowed. */
export function allowedOrigin(origin, policy) {
  if (policy.any) return "*";
  if (!origin) return null;
  const o = String(origin).toLowerCase();
  if (policy.exact.has(o) || policy.patterns.some((re) => re.test(o))) return origin;
  return null;
}
