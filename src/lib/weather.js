/* Pure weather helpers for the header chip: WMO code → kind/label, real-world day/night
   from sunrise/sunset (not the site theme), and lunar phase. */

export function weatherKind(code) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return "cloudy";
}

const LABELS = { clear: "Clear", partly: "Partly cloudy", cloudy: "Cloudy", fog: "Foggy", drizzle: "Drizzle", rain: "Rain", snow: "Snow", thunder: "Thunderstorm" };
export const weatherLabel = (code) => (code === 1 ? "Mostly clear" : LABELS[weatherKind(code)]);

/* sunrise/sunset are unix seconds; falls back to the provider's is_day flag */
export function isNight({ sunrise, sunset, isDay }, nowMs) {
  const t = Math.floor(nowMs / 1000);
  if (Number.isFinite(sunrise) && Number.isFinite(sunset)) return t < sunrise || t >= sunset;
  if (isDay === 0 || isDay === 1) return isDay === 0;
  return false;
}

/* 0 = new, .25 = first quarter, .5 = full, .75 = last quarter */
const SYNODIC = 29.53058867;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
export function moonPhase(nowMs) {
  const p = (((nowMs - REF_NEW_MOON) / 86400000) % SYNODIC) / SYNODIC;
  return p < 0 ? p + 1 : p;
}
export function moonPhaseName(p) {
  if (p < 0.03 || p >= 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

/* Open-Meteo (no key). Throws on a bad response — the chip never shows made-up weather. */
export async function fetchWeather(lat, lon) {
  const q = new URLSearchParams({ latitude: lat, longitude: lon, current: "temperature_2m,apparent_temperature,weather_code,is_day", daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min", timezone: "auto", timeformat: "unixtime", forecast_days: "1" });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  const temp = Number(j?.current?.temperature_2m), code = Number(j?.current?.weather_code);
  if (!Number.isFinite(temp) || !Number.isFinite(code)) throw new Error("bad weather response");
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v)); // missing stays missing, never 0
  return { temp, code, feels: num(j.current.apparent_temperature), hi: num(j?.daily?.temperature_2m_max?.[0]), lo: num(j?.daily?.temperature_2m_min?.[0]), isDay: j.current.is_day, sunrise: j?.daily?.sunrise?.[0], sunset: j?.daily?.sunset?.[0], tz: typeof j.timezone === "string" ? j.timezone : "" };
}
