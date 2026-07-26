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

export const USER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
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
  let candidateDate = sendDate || localDateOf(orderUtc, tz);
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

/* ─── UTC day-wise wait schedule (PRD spec) ─────────────────────────────── */

const UNIT_MS = { minutes: 60000, hours: 3600000, days: 86400000 };

export function buildWaitSchedule({ startDate, startTime, amount, unit, repetitions, tz1, tz2 }) {
  if (!startDate || !startTime || !amount || amount <= 0 || !repetitions) return [];
  const [y, mo, d] = startDate.split("-").map(Number);
  const [h, mi] = startTime.split(":").map(Number);
  const start = Date.UTC(y, mo - 1, d, h, mi, 0);
  const step = amount * (UNIT_MS[unit] || UNIT_MS.hours);
  const rows = [];
  const n = Math.min(Math.max(1, +repetitions), 120);
  for (let i = 0; i < n; i++) {
    const t = new Date(start + i * step);
    rows.push({
      idx: i + 1, t,
      utcTime: fmtUtc(t), utcDate: fmtUtcDate(t),
      localTime: fmtLocal(t, tz1), localDate: fmtLocalDate(t, tz1),
      cmpTime: tz2 ? fmtLocal(t, tz2) : null, cmpDate: tz2 ? fmtLocalDate(t, tz2) : null,
      dow: dowOf(t, "local", tz1),
      isWeekend: [0, 6].includes(dowOf(t, "local", tz1)),
      localDayStr: localDateOf(t, tz1),
      iso: t.toISOString(),
    });
  }
  return rows;
}

/* ─── validation warnings (audited v2) ──────────────────────────────────── */

export function getDateTimeWarning(dateStr, timeStr, tz, label) {
  if (!dateStr || !timeStr || !tz) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const utcDate = zonedToUtc(dateStr, timeStr, tz);
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
export const fmtLocalDate = (d, tz) => { const p = zoneParts(d, tz); return `${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}`; };

export function offsetLabel(tz, date = new Date()) {
  const p = zoneParts(date, tz);
  const om = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
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
