/* Phone batch helpers: per-row local time / call window, column sorting and the session draft. */
import { fmtLocal, zoneParts } from "./time.js";
import { callWindow } from "./phoneCall.js";

const TONE_RANK = { good: 0, warn: 1, bad: 2 };
const TONE_SHORT = { good: "Business hours", warn: "Outside office hours", bad: "Night-time" };
const NONE = { local: "", mins: null, tone: "", window: "", label: "", rank: null };

/* Local time and call window for a row's zone at `now` (blank fields when the zone is unknown). */
export function rowTimes(zone, now = new Date()) {
  if (!zone) return NONE;
  try {
    const p = zoneParts(now, zone);
    const [tone, text] = callWindow(p.hour);
    return { local: fmtLocal(now, zone), mins: p.hour * 60 + p.minute, tone, window: text, label: TONE_SHORT[tone], rank: TONE_RANK[tone] };
  } catch { return NONE; }
}

/* Sort keys per column; null/"" always sorts last whichever way the column is sorted. */
const KEYS = {
  input: (r) => r.input,
  status: (r) => r.status,
  country: (r) => r.country || "",
  e164: (r) => r.e164 || "",
  type: (r) => r.type || "",
  local: (r, t) => t.mins,
  call: (r, t) => (t.rank == null ? null : t.rank * 1440 + t.mins), // best window first, then by local time
};
export const SORT_COLS = Object.keys(KEYS);

const blank = (v) => v == null || v === "";

/** Stable sort of `rows` by column `key` ("asc" | "desc"); `times(row)` supplies rowTimes for the time columns. */
export function sortRows(rows, key, dir = "asc", times = (r) => rowTimes(r.zone)) {
  const get = KEYS[key];
  if (!get) return rows;
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i, v: get(r, key === "local" || key === "call" ? times(r) : null) }))
    .sort((a, b) => {
      if (blank(a.v) || blank(b.v)) return blank(a.v) === blank(b.v) ? a.i - b.i : blank(a.v) ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Header click: a new column starts ascending; the same column goes asc → desc → unsorted. */
export function nextSort(cur, key) {
  if (!cur || cur.key !== key) return { key, dir: "asc" };
  return cur.dir === "asc" ? { key, dir: "desc" } : null;
}

export const DRAFT_KEY = "toolDeck.phoneBatchDraft";
export const DRAFT_MAX = 200_000; // chars; bigger pastes aren't kept (sessionStorage quota is ~5 MB, shared)

/** Draft { text, region } from storage, or null. Never throws. */
export function loadDraft(storage) {
  try {
    const v = JSON.parse(storage.getItem(DRAFT_KEY) || "null");
    if (!v || typeof v.text !== "string" || v.text.length > DRAFT_MAX) return null;
    return { text: v.text, region: typeof v.region === "string" && /^[A-Z]{2}$/.test(v.region) ? v.region : "" };
  } catch { return null; }
}

/** Store the draft; an empty or oversized draft clears the key so a stale one never comes back. Never throws. */
export function saveDraft(storage, { text, region }) {
  try {
    if ((!text && !region) || text.length > DRAFT_MAX) storage.removeItem(DRAFT_KEY);
    else storage.setItem(DRAFT_KEY, JSON.stringify({ text, region }));
  } catch { /* storage unavailable or full */ }
}
