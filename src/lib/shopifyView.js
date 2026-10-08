/* Pure view helpers for the Shopify Store Detector (shopify-check response → UI). */

/** Extra store facts as tiles — only the ones the server actually returned. */
export function detailTiles(data) {
  const d = data || {};
  const tiles = [];
  if (typeof d.theme === "string" && d.theme.trim()) {
    const id = Number.isFinite(d.theme_store_id) ? d.theme_store_id : null;
    tiles.push({ k: "Theme", v: d.theme.trim(), title: id ? `${d.theme.trim()} (theme store #${id})` : d.theme.trim() });
  }
  /* plus=false only means no indicators were seen — not proof of a non-Plus plan, so it gets no tile */
  if (d.plus === true) tiles.push({ k: "Shopify Plus", v: "Indicators found" });
  if (typeof d.currency === "string" && /^[A-Z]{3}$/.test(d.currency)) tiles.push({ k: "Currency", v: d.currency });
  /* /products.json is probed with limit=1, so this proves a public catalog rather than counting it */
  if (Number.isFinite(d.product_count) && d.product_count >= 0) {
    tiles.push({ k: "Catalog", v: d.product_count === 0 ? "Public, empty" : `Public, ${d.product_count}+ product${d.product_count === 1 ? "" : "s"}` });
  }
  return tiles;
}

/** Seconds to wait after a 429: the body's retry_after, else the Retry-After header (seconds form). */
export function retryAfterSec(body, header) {
  const fromBody = Number(body?.error?.retry_after);
  const fromHeader = header != null && /^\s*\d+\s*$/.test(String(header)) ? Number(header) : NaN;
  const s = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : fromHeader;
  return Number.isFinite(s) && s > 0 ? Math.min(3600, Math.ceil(s)) : null;
}

/** Short label for the Recent checks chip. */
export function verdictLabel(kind) {
  return { yes: "Shopify", uncertain: "Possibly", blocked: "Blocked", no: "Not Shopify" }[kind] || "";
}
