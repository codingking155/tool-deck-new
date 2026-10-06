/* Pure helpers for the breach checker. Used by the browser (passwords) and the
   Supabase edge function (email). No network, no DOM. */

export const isValidEmail = (s) =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export async function sha1Hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** HIBP Pwned Passwords range response ("SUFFIX:COUNT" lines). Padding rows (count 0) are ignored. */
export function pwnedCount(rangeText, suffix) {
  const want = String(suffix).toUpperCase();
  for (const line of String(rangeText).split(/\r?\n/)) {
    const [sfx, n] = line.trim().split(":");
    if (sfx && sfx.toUpperCase() === want) return Number(n) || 0;
  }
  return 0;
}

const SEVERE = /password|credit|card|bank|ssn|social security|passport|security question|payment/i;

/** One breach record in the shape the UI uses. */
function normalizeBreach(b) {
  const data = String(b.xposed_data ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const year = String(b.xposed_date ?? "").match(/\d{4}/)?.[0] ?? null;
  return {
    name: String(b.breach ?? "Unknown"),
    domain: b.domain ? String(b.domain) : null,
    year: year ? Number(year) : null,
    records: Number.isFinite(Number(b.xposed_records)) ? Number(b.xposed_records) : null,
    dataTypes: data,
    severe: data.some((d) => SEVERE.test(d)),
    description: b.details ? String(b.details).replace(/<[^>]*>/g, "").slice(0, 400) : null,
    verified: String(b.verified ?? "").toLowerCase() === "yes",
  };
}

/** XposedOrNot breach-analytics payload -> breaches[]. Returns null when the shape is unrecognised
    (so the caller reports an error instead of a false "all clear").
    A clean address comes back 200 with `ExposedBreaches: null` alongside a `BreachesSummary` object;
    that (and only that) is treated as zero breaches. */
export function parseXonAnalytics(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.ExposedBreaches == null) {
    return payload.BreachesSummary && typeof payload.BreachesSummary === "object" ? [] : null;
  }
  const details = payload.ExposedBreaches.breaches_details;
  if (!Array.isArray(details)) return null;
  return details.filter((b) => b && typeof b === "object").map(normalizeBreach)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/** XposedOrNot answers 404 "Not found" for an address in no known breach (or one the owner has shielded).
    Older responses used {"Error":...}; the current FastAPI service uses {"detail":...}. */
export const isXonNotFound = (status, payload) =>
  status === 404 && /^not found$/i.test(String(payload?.detail ?? payload?.Error ?? payload?.error ?? "").trim());

export function summarize(breaches) {
  const types = new Set();
  breaches.forEach((b) => b.dataTypes.forEach((t) => types.add(t)));
  return { count: breaches.length, severe: breaches.some((b) => b.severe), dataTypes: [...types].sort() };
}
