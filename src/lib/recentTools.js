/* Recently opened tools — a short, device-local history (no account, no server). */

export const RECENT_KEY = "toolDeck.recent";
export const RECENT_MAX = 6;

const store = (s) => s || (typeof localStorage !== "undefined" ? localStorage : null);

/** Ids of recently opened tools, newest first, filtered to ids that still exist. */
export function readRecent(validIds, storage) {
  try {
    const v = JSON.parse(store(storage)?.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(v)) return [];
    const ok = validIds ? new Set(validIds) : null;
    return v.filter((id) => typeof id === "string" && (!ok || ok.has(id))).slice(0, RECENT_MAX);
  } catch { return []; }
}

/** Move `id` to the front; returns the new list. Never throws (private mode / full storage). */
export function pushRecent(id, storage) {
  const next = [id, ...readRecent(null, storage).filter((x) => x !== id)].slice(0, RECENT_MAX);
  try { store(storage)?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}

export function clearRecent(storage) {
  try { store(storage)?.removeItem(RECENT_KEY); } catch { /* storage unavailable */ }
}
