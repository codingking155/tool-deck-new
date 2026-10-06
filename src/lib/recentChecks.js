/* "Recent checks" for the Shopify tools: newest first, de-duplicated by host, kept on this device only. */

export function hostOf(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./i, "").toLowerCase() || null; }
  catch { return null; }
}

export function addRecent(list, entry, max = 8) {
  if (!entry || !entry.host) return list;
  return [{ host: entry.host, label: String(entry.label || "").slice(0, 40), at: entry.at ?? Date.now() },
    ...list.filter((e) => e.host !== entry.host)].slice(0, max);
}

export function loadRecent(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((e) => e && typeof e.host === "string").slice(0, 8) : [];
  } catch { return []; }
}

export function saveRecent(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage unavailable */ } }
