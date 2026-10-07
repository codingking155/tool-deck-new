import { TOOLS } from "../toolsMeta.js";

const IDS = new Set(TOOLS.map((t) => t.id));

/** The path Vercel Analytics / Speed Insights may see: the page or tool, never what follows the tool id
    (it can hold a product URL, an IP or a phone number the user typed), the query string or the hash. */
export function metricsPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (p === "/") return "/";
  if (p === "/tool/price/alerts") return p;
  const m = /^\/tool\/([^/]+)/.exec(p);
  return m && IDS.has(m[1]) ? `/tool/${m[1]}` : "/not-found";
}

/** beforeSend hook for both libraries: rewrites the event URL to the scrubbed path. */
export function scrubEvent(e) {
  try { const u = new URL(e.url); return { ...e, url: u.origin + metricsPath(u.pathname) }; }
  catch { return null; } // unparseable URL: drop the event rather than risk sending it
}
