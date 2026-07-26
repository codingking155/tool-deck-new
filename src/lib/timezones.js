/**
 * Timezone index — built once at module load from Intl.supportedValuesOf,
 * enriched with country names/flags from the phone tables, searchable by a
 * pre-lowercased haystack string (no per-keystroke lowercasing of the list).
 */
import { COUNTRIES, NANP_INFO, flagOf } from "./phone.js";

const DEPRECATED = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv", "Asia/Rangoon": "Asia/Yangon", "Asia/Katmandu": "Asia/Kathmandu",
};

const COUNTRY_BY_ZONE = (() => {
  const m = new Map();
  for (const [, iso, name, zone] of COUNTRIES) if (!m.has(zone)) m.set(zone, { iso, name });
  for (const [iso, [name, zone]] of Object.entries(NANP_INFO)) if (!m.has(zone)) m.set(zone, { iso, name });
  return m;
})();

export const ZONES = (() => {
  let list = [];
  try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf("timeZone"); } catch { /* older engines */ }
  const set = new Set(list.map((z) => DEPRECATED[z] || z));
  for (const c of COUNTRIES) set.add(c[3]);
  for (const [, [, z]] of Object.entries(NANP_INFO)) set.add(z);
  set.add("UTC");
  const entries = [...set].sort().map((zone) => {
    const city = zone.split("/").pop().replace(/_/g, " ");
    const c = zone === "UTC" ? { iso: "", name: "Universal Time" } : COUNTRY_BY_ZONE.get(zone);
    return {
      zone, city, flag: c && c.iso ? flagOf(c.iso) : "🌐",
      label: c ? `${c.name} — ${city}` : city,
      hay: `${zone} ${city} ${c ? c.name : ""}`.toLowerCase(),
    };
  });
  entries.sort((a, b) => (a.zone === "UTC" ? -1 : b.zone === "UTC" ? 1 : 0));
  return entries;
})();

export const searchZones = (q) => {
  const s = q.trim().toLowerCase();
  return s ? ZONES.filter((e) => e.hay.includes(s)) : ZONES;
};
