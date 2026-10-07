/**
 * Time core — single source of truth for every date/timezone computation.
 *
 * This is the audited v2 UTC-scheduler core (utc-scheduler-core.js) merged with
 * the app-level formatters. Key guarantees carried over from the audit:
 *  - Intl.DateTimeFormat instances are cached per zone (construction ~0.5 ms).
 *  - Wall-clock → UTC conversion converges through DST gaps/folds.
 *  - Day advancement always re-resolves through the zone anchored at local noon,
 *    so a DST shift can never skip or repeat a calendar day.
 *  - Weekend skipping supports a configurable evaluation basis ("utc" | "local")
 *    and reports each skipped candidate for the UI timeline / audit logs.
 */

export const pad = (n) => String(n).padStart(2, "0");
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Legacy IANA names some engines still report (Chromium: Asia/Calcutta) → the
// current names the zone list uses, so lookups by zone id match.
const DEPRECATED_ZONES = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv", "Asia/Rangoon": "Asia/Yangon", "Asia/Katmandu": "Asia/Kathmandu",
};
export const canonicalZone = (z) => DEPRECATED_ZONES[z] || z;

export const USER_TZ = (() => {
  try { return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); } catch { return "UTC"; }
})();

/* ─── cached per-zone formatter ─────────────────────────────────────────── */

const fmtCache = new Map();
export function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** True when Intl accepts the zone id (guards ids arriving from URLs / old browsers). */
export function isValidZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { partsFormatter(tz); return true; } catch { return false; }
}

export function zoneParts(date, tz) {
  const m = {};
  for (const p of partsFormatter(tz).formatToParts(date)) if (p.type !== "literal") m[p.type] = p.value;
  return { year: +m.year, month: +m.month, day: +m.day, hour: +m.hour, minute: +m.minute, second: +m.second };
}

/* ─── core conversion: local wall-clock → UTC (DST-safe) ────────────────── */

export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  let g = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  let last = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = zoneParts(g, tz);
    const diff = Date.UTC(y, mo - 1, d, h, mi, 0) - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    g = new Date(g.getTime() + diff);
    if (diff === 0) break;
    if (Math.abs(diff) >= Math.abs(last) && i >= 2) break; // DST gap/fold oscillation
    last = diff;
  }
  return g;
}

/* ─── calendar helpers ──────────────────────────────────────────────────── */

/** Local calendar date (YYYY-MM-DD) of an instant, in a zone. */
export function localDateOf(d, tz) {
  const p = zoneParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Advance a local calendar date string by one day, re-resolving through the zone (DST-safe). */
export function nextLocalDate(dateStr, tz) {
  // Anchor at local noon so a DST shift can never skip/repeat a calendar day.
  const noon = zonedToUtc(dateStr, "12:00", tz);
  const p = zoneParts(new Date(noon.getTime() + 86400000), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Day-of-week of an instant on the UTC calendar or in a zone. 0=Sun..6=Sat */
export function dowOf(d, basis, tz) {
  if (basis === "local") {
    const p = zoneParts(d, tz);
    return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  }
  return d.getUTCDay();
}

export function isNonWorkingDay(dateUtc, options = {}) {
  const { skipWeekends = true, weekendBasis = "utc", timeZone = "UTC", nonWorkingDays = [0, 6] } = options;
  if (!skipWeekends) return false;
  return nonWorkingDays.includes(dowOf(dateUtc, weekendBasis, timeZone));
}

/* ─── weekend-aware send resolution (audited v2) ────────────────────────── */

/**
 * Find the next valid send instant (UTC) strictly after orderUtc such that:
 *   1. the send time-of-day matches sendTime in the customer's zone, and
 *   2. the send day is a working day (weekends skipped by default).
 *
 * Example (primary requirement):
 *   Order Friday 18:00 → candidate Sat 08:00 rejected → Sun rejected → Monday 08:00. ✔
 *
 * Returns { sendUtc, skippedDays } — skippedDays lists each rejected candidate.
 */
export function getNextValidSendUtc(orderUtc, sendTime, tz, options = {}) {
  const {
    sendDate = null,
    skipWeekends = true,
    weekendBasis = "utc",
    nonWorkingDays = [0, 6],
    maxDays = 60,
  } = options;
  const dayOpts = { skipWeekends, weekendBasis, timeZone: tz, nonWorkingDays };
  // A fixed send date before the order's local date can never be valid — start from the later one.
  const orderLocal = localDateOf(orderUtc, tz);
  let candidateDate = sendDate && sendDate > orderLocal ? sendDate : orderLocal;
  const skippedDays = [];

  for (let i = 0; i < maxDays; i++) {
    const candidateUtc = zonedToUtc(candidateDate, sendTime, tz);
    const tooEarly = candidateUtc.getTime() <= orderUtc.getTime();
    const nonWorking = isNonWorkingDay(candidateUtc, dayOpts);
    if (!tooEarly && !nonWorking) return { sendUtc: candidateUtc, skippedDays };
    if (!tooEarly && nonWorking) {
      skippedDays.push({ date: candidateDate, dow: dowOf(candidateUtc, weekendBasis, tz) });
    }
    candidateDate = nextLocalDate(candidateDate, tz); // never mutates, always re-resolves
  }
  throw new Error("No valid send day found within 60 days — check the non-working-day configuration.");
}

/* ─── validation warnings (audited v2) ──────────────────────────────────── */

export function getDateTimeWarning(dateStr, timeStr, tz, label) {
  if (!dateStr || !timeStr || !tz) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null; // malformed (e.g. from a URL)
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const utcDate = zonedToUtc(dateStr, timeStr, tz);
  if (Number.isNaN(utcDate.getTime())) return null;
  const p = zoneParts(utcDate, tz);
  const matches = p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  if (!matches) {
    return `${label} falls inside a timezone transition. The closest valid local time was used for UTC conversion.`;
  }
  const before = offsetLabel(tz, new Date(utcDate.getTime() - 12 * 3600 * 1000));
  const after = offsetLabel(tz, new Date(utcDate.getTime() + 12 * 3600 * 1000));
  if (before !== after) {
    return `${label} is close to a daylight-saving change (${before} → ${after}). Verify the UTC result.`;
  }
  return null;
}

/* ─── formatting ────────────────────────────────────────────────────────── */

export const fmtUtc = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
export const fmtUtcDate = (d) => `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtLocal = (d, tz) => { const p = zoneParts(d, tz); return `${pad(p.hour)}:${pad(p.minute)}`; };

/** Minutes the zone is ahead of UTC at `date` (negative = behind). */
export function offsetMinutes(tz, date = new Date()) {
  const p = zoneParts(date, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
}

export function offsetLabel(tz, date = new Date()) {
  const om = offsetMinutes(tz, date);
  if (om === 0) return "GMT";
  const s = om >= 0 ? "+" : "-", a = Math.abs(om), h = Math.floor(a / 60), m = a % 60;
  return m === 0 ? `GMT${s}${h}` : `GMT${s}${h}:${pad(m)}`;
}

export function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const tm = Math.floor(ms / 60000);
  const d = Math.floor(tm / 1440), h = Math.floor((tm % 1440) / 60), m = tm % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export const fmt12 = (h, m) => `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;

/* ─── order → target-send wait (no weekend rules) ───────────────────────── */

/** Next instant after orderUtc whose local wall-clock is sendTime; a fixed sendDate is honoured, then advanced day-by-day (DST-safe) if it is not after the order. A sendDate before the order date starts from the order date. */
export function nextSendUtc(orderUtc, orderDate, sendTime, tz, sendDate = "", opts = {}) {
  if (opts.skipWeekends) {
    return getNextValidSendUtc(orderUtc, sendTime, tz, { sendDate: sendDate || null, skipWeekends: true, weekendBasis: "local" }).sendUtc;
  }
  let date = sendDate && sendDate > orderDate ? sendDate : orderDate;
  let send = zonedToUtc(date, sendTime, tz);
  for (let i = 0; i < 30 && send <= orderUtc; i++) { date = nextLocalDate(date, tz); send = zonedToUtc(date, sendTime, tz); }
  return send;
}

/** Weekend days skipped for a given order (empty unless skipWeekends). */
export function skippedWeekendDays(orderUtc, sendTime, tz, sendDate = "") {
  return getNextValidSendUtc(orderUtc, sendTime, tz, { sendDate: sendDate || null, skipWeekends: true, weekendBasis: "local" }).skippedDays;
}

export function fmtDurDays(ms) {
  const tm = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(tm / 1440), h = Math.floor((tm % 1440) / 60), m = tm % 60;
  return d > 0 ? `${d} day${d > 1 ? "s" : ""} ${h} hr ${m} min` : `${h} hr ${m} min`;
}

export const fmt12Str = (t) => { const [h, m] = t.split(":").map(Number); return fmt12(h, m); };

/** 24 hourly what-if rows starting at the order time (local wall-clock steps). */
export function buildOrderRows(orderDate, orderTime, sendTime, tz, sendDate = "", opts = {}) {
  if (!orderDate || !orderTime || !sendTime || !tz) return [];
  const [y, mo, d] = orderDate.split("-").map(Number);
  const [sh, sm] = orderTime.split(":").map(Number);
  const start = Date.UTC(y, mo - 1, d, sh, sm, 0);
  const rows = [];
  for (let i = 0; i < 24; i++) {
    try {
      const w = new Date(start + i * 3600000);
      const localDate = `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
      const local24 = `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
      const orderUtc = zonedToUtc(localDate, local24, tz);
      const sendUtc = nextSendUtc(orderUtc, localDate, sendTime, tz, sendDate, opts);
      const waitMs = sendUtc - orderUtc;
      if (!(waitMs > 0)) continue;
      rows.push({
        localDate, local24, local12: fmt12Str(local24), offset: offsetLabel(tz, orderUtc),
        utcOrder: fmtUtc(orderUtc), utcOrderDate: fmtUtcDate(orderUtc),
        targetUtc: fmtUtc(sendUtc), targetUtcDate: fmtUtcDate(sendUtc), wait: fmtDurDays(waitMs),
      });
    } catch { /* skip an unresolvable hour */ }
  }
  return rows;
}
