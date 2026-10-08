/* CSP violation report parsing (csp-report edge function). Pure, so it runs under node:test and Deno.

   Browsers send two shapes:
     report-uri  → Content-Type application/csp-report, body {"csp-report": {"violated-directive": …}}
     report-to   → Content-Type application/reports+json, body [{type:"csp-violation", body:{effectiveDirective: …}}]

   What is kept is only what's needed to fix the policy: directive, blocked origin (or keyword), page and
   source file reduced to path prefixes. Query strings, fragments, script samples and anything after a tool
   id (which can hold a product URL, an IP or a phone number the user typed) are dropped. */

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_REPORTS = 20;

const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "self", "data", "blob"]);
const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i;
const clip = (s, n = 200) => String(s ?? "").slice(0, n);

/** "https://a.b/x/y?q#h" → "https://a.b"; keywords ("inline", "eval", "data:…") → the keyword. */
export function blockedOf(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (KEYWORDS.has(low)) return low;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme && !/^https?$|^wss?$/i.test(scheme[1])) return `${scheme[1].toLowerCase()}:`;
  try { return new URL(s).origin; } catch { return clip(low, 40); }
}

/** The page, reduced to "/", "/tool/<id>" (+ "/alerts" for the price alerts page), "/sheaf" or "/other". */
export function pageOf(raw) {
  let p;
  try { p = new URL(String(raw ?? "")).pathname; } catch { return ""; }
  if (p === "/" || p === "") return "/";
  if (p === "/tool/price/alerts") return p;
  const m = /^\/tool\/([a-z0-9-]{1,40})(?:\/|$)/i.exec(p);
  if (m) return `/tool/${m[1].toLowerCase()}`;
  if (p.startsWith("/sheaf")) return "/sheaf";
  return "/other";
}

/** Script that triggered it: same-site file path without query, or a foreign origin. */
function sourceOf(raw, page) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return /\.(m?js|css|html?)$/i.test(u.pathname) ? clip(u.origin + u.pathname) : u.origin;
  } catch { return blockedOf(s) || page; }
}

function normalize(r) {
  if (!r || typeof r !== "object") return null;
  const directive = clip(r.effectiveDirective ?? r["effective-directive"] ?? r["violated-directive"] ?? "", 60).split(" ")[0].toLowerCase();
  const blockedRaw = r.blockedURL ?? r["blocked-uri"] ?? "";
  const sourceRaw = r.sourceFile ?? r["source-file"] ?? "";
  if (!directive || EXTENSION.test(String(blockedRaw)) || EXTENSION.test(String(sourceRaw))) return null;
  const page = pageOf(r.documentURL ?? r["document-uri"]);
  if (!page) return null;
  const disposition = String(r.disposition ?? "enforce").toLowerCase() === "report" ? "report" : "enforce";
  return { directive, blocked: blockedOf(blockedRaw), page, source: sourceOf(sourceRaw, page), disposition };
}

/** Parse a report request body into at most MAX_REPORTS normalized violations (extensions dropped). */
export function parseCspReports(text, contentType = "") {
  if (typeof text !== "string" || !text || text.length > MAX_BODY_BYTES) return [];
  let body;
  try { body = JSON.parse(text); } catch { return []; }
  const ct = String(contentType).toLowerCase();
  let raw = [];
  if (Array.isArray(body)) raw = body.filter((x) => x?.type === "csp-violation").map((x) => x.body);
  else if (body && typeof body === "object" && body["csp-report"]) raw = [body["csp-report"]];
  else if (ct.includes("csp-report") && body && typeof body === "object") raw = [body];
  const out = [];
  for (const r of raw.slice(0, MAX_REPORTS)) { const n = normalize(r); if (n) out.push(n); }
  return out;
}
