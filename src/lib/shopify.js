/** Browser entry for the Shopify detector.
    The detection engine itself lives in shared/shopifyCore/detect.mjs so the
    server API (supabase/functions/shopify-check) scores identically. */

export { SHOPIFY_SIGNALS, HEADER_SIGNALS, analyzeShopify, applyHeaderSignals, buildReport } from "../../shared/shopifyCore/detect.mjs";
import { analyzeShopify, applyHeaderSignals } from "../../shared/shopifyCore/detect.mjs";

/* Fetch page HTML: try direct first, then public read-only CORS proxies so a
   live URL check works from the browser. A production deploy should still use
   its own server proxy (URL validation + SSRF protection + rate limiting). */
export async function fetchPageSource(full) {
  const attempts = [
    { u: full, direct: true },
    { u: `https://api.allorigins.win/raw?url=${encodeURIComponent(full)}` },
    { u: `https://corsproxy.io/?url=${encodeURIComponent(full)}` },
    { u: `https://r.jina.ai/${full}` },
  ];
  for (const a of attempts) {
    try {
      const r = await fetch(a.u, { cache: "no-store" });
      if (!r.ok) continue;
      const text = await r.text();
      if (text && text.length > 60) return { text, viaProxy: !a.direct };
    } catch { /* try next */ }
  }
  throw new Error("unreachable");
}

/* Server-first check: when a ToolDeck API is configured, use it — it reads
   response headers (conclusive evidence) and dodges CORS entirely. */
export async function serverCheck(full) {
  const base = import.meta.env?.VITE_SUPABASE_URL;
  if (!base) return null;
  try {
    const r = await fetch(`${base}/functions/v1/shopify-check?url=${encodeURIComponent(full)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;
    return j;
  } catch { return null; }
}
