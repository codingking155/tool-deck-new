import { useState, useEffect, useRef } from "react";
import { Sun, Moon, Cloud, CloudSun, CloudMoon, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, MapPin, LocateFixed } from "lucide-react";
import { useIpLocale } from "../hooks/index.js";
import { pad, zoneParts, fmtUtc, isValidZone } from "../lib/time.js";
import { fetchWeather, weatherKind, weatherLabel, isNight, moonPhase, moonPhaseName } from "../lib/weather.js";

const REFRESH_MS = 45 * 60 * 1000;
const CACHE_KEY = "toolDeck.wx2"; // v2 adds feels-like / high / low // IP-location weather only; GPS results are never written to storage

function readCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    return c && Date.now() - c.at < REFRESH_MS ? c : null;
  } catch { return null; }
}

/* Re-renders once a minute, on the minute (the chip shows HH:MM, so a 1 s tick is wasted work). */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id;
    const tick = () => { setNow(new Date()); id = setTimeout(tick, 60000 - (Date.now() % 60000) + 50); };
    id = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    return () => clearTimeout(id);
  }, []);
  return now;
}

const hhmm = (d, tz) => { const p = zoneParts(d, tz); return `${pad(p.hour)}:${pad(p.minute)}`; };

/* Leaf clocks: only these re-render each minute, not the weather part. */
function ClockText({ tz, place }) {
  const now = useMinute();
  return <span className="t-loc">{hhmm(now, tz)}<small>{place.toUpperCase()}</small></span>;
}
function ClockRows({ tz }) {
  const now = useMinute();
  return (
    <>
      <div className="row"><span>Local</span><b>{hhmm(now, tz)}</b></div>
      <div className="row"><span>UTC</span><b>{fmtUtc(now)}</b></div>
      <div className="row"><span>Time zone</span><b>{tz}</b></div>
    </>
  );
}

function WeatherIcon({ code, night, size = 18 }) {
  const k = weatherKind(code);
  const I = k === "clear" ? (night ? Moon : Sun) : k === "partly" ? (night ? CloudMoon : CloudSun)
    : k === "fog" ? CloudFog : k === "drizzle" ? CloudDrizzle : k === "rain" ? CloudRain
    : k === "snow" ? CloudSnow : k === "thunder" ? CloudLightning : Cloud;
  /* tint + motion follow the weather; motion is switched off by prefers-reduced-motion in CSS */
  const tone = night ? "night" : k === "clear" || k === "partly" ? "sun" : k === "cloudy" || k === "fog" ? "grey" : "wet";
  return <span className={`wx-ico wx-${tone} wx-k-${k}${night ? " wx-nt" : ""}`} aria-hidden="true"><I size={size} className="wx-ic" /></span>;
}

/* Temperature that slides from the old value to the new one on refresh (no motion if reduced). */
function Temp({ value }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (!Number.isFinite(from.current) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { from.current = value; setShown(value); return; }
    const a = from.current, t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 600), e = 1 - (1 - k) ** 3;
      from.current = a + (value - a) * e;
      setShown(from.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return Number.isFinite(shown) ? `${Math.round(shown)}°` : "--°";
}

const deg = (v) => `${Math.round(v)}°`;

/* Popover header card: big icon, temperature, condition, feels-like and today's high/low.
   Fields the API didn't return are left out, never filled in. */
function WxHeader({ wx, night, label, phase }) {
  return (
    <div className="wx-card">
      <WeatherIcon code={wx.code} night={night} size={30} />
      <div className="wx-card-tx">
        <b className="wx-big"><Temp value={wx.temp} /></b>
        <span className="wx-cond">{label}{night ? ` · ${phase}` : ""}</span>
        {Number.isFinite(wx.feels) && <span className="wx-sub">Feels like {deg(wx.feels)}</span>}
        {Number.isFinite(wx.hi) && Number.isFinite(wx.lo) && (
          <span className="wx-sub"><span className="wx-hi">H {deg(wx.hi)}</span> · <span className="wx-lo">L {deg(wx.lo)}</span></span>
        )}
      </div>
    </div>
  );
}

/* Header chip: weather icon + temperature + condition, then local time and city (zone and city from IP,
   falling back to the device timezone). Precise location only on click.
   Day/night comes from real sunrise/sunset, never from the site theme. Coordinates are never stored.
   Real data only — if the weather can't load, it says so. */
export default function WeatherChip() {
  const ipd = useIpLocale();
  const [gps, setGps] = useState(null); // null | "loading" | {lat,lon,city,region} | {err}
  const [wx, setWx] = useState(null); // null | {temp,code,isDay,sunrise,sunset,tz} | {err}
  const [now, setNow] = useState(() => Date.now()); // day/night only; 1 min is plenty
  const ref = useRef(null);

  const lat = gps?.lat ?? ipd.lat, lon = gps?.lon ?? ipd.lon;

  /* load + refresh every 45 min and on return to the tab. IP-location weather is cached for the
     session so reloads within 45 min show it instantly without a request. */
  const precise = !!gps && Number.isFinite(gps.lat);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    let alive = true, last = 0;
    const load = () => {
      last = Date.now();
      fetchWeather(lat, lon).then((w) => {
        if (!alive) return;
        setWx(w);
        if (!precise) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: last, w })); } catch { /* storage blocked */ } }
      }).catch(() => alive && setWx((p) => (p && !p.err ? p : { err: true })));
    };
    const c = !precise && readCache();
    if (c) { last = c.at; setWx(c.w); } else load();
    const id = setInterval(() => { if (Date.now() - last >= REFRESH_MS - 1000) load(); }, 60000);
    const vis = () => { if (document.visibilityState === "visible" && Date.now() - last > REFRESH_MS) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [lat, lon, precise]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);

  /* close the popover on outside click / Escape, returning focus to the trigger */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const down = (e) => { if (el.open && !el.contains(e.target)) el.open = false; };
    const key = (e) => { if (e.key === "Escape" && el.open) { el.open = false; el.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, []);

  const locate = () => {
    if (!navigator.geolocation) { setGps({ err: "GPS unsupported here" }); return; }
    setGps("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let city = "", region = "";
        try {
          const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`)).json();
          city = j.city || j.locality || ""; region = j.principalSubdivision || "";
        } catch { /* weather still works without a place name */ }
        setGps({ lat: latitude, lon: longitude, city, region });
      },
      (e) => setGps({ err: e && e.code === 1 ? "Permission denied" : "Location unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  };

  const city = (precise && gps.city) || ipd.city;
  const region = (precise && gps.city && gps.region) || (!precise && ipd.region) || "";
  const place = city ? `${city}${region ? `, ${region}` : ""}` : precise ? "Precise location" : "Approximate location";
  const ok = wx && !wx.err;
  const night = ok && isNight(wx, now);
  const phase = moonPhaseName(moonPhase(now));
  const temp = ok ? `${Math.round(wx.temp)}°` : "";
  /* with precise location, the time follows that place's zone (from the weather lookup), not the IP's */
  const tz = precise && ok && isValidZone(wx.tz) ? wx.tz : ipd.tz;
  const shortPlace = city || tz.split("/").pop().replace(/_/g, " ");
  const label = ok ? weatherLabel(wx.code) : wx?.err ? "Weather unavailable" : "Loading weather";

  return (
    <details className="clk wx" ref={ref}>
      <summary aria-label={`${ok ? `${temp}C, ${label}, ${night ? `night, ${phase}` : "day"}` : label}. Local time in ${shortPlace}. Show weather and location details`}>
        {ok ? <WeatherIcon code={wx.code} night={night} /> : <MapPin size={16} aria-hidden="true" className="wx-ic" />}
        <span className="wx-tmp">{ok ? <Temp value={wx.temp} /> : "--°"}</span>
        <span className="t-sep" aria-hidden="true" />
        <ClockText tz={tz} place={shortPlace} />
      </summary>
      <div className="clk-pop">
        {ok ? <WxHeader wx={wx} night={night} label={label} phase={phase} /> : <p className="wx-card wx-none">{wx?.err ? "Unable to retrieve the latest weather right now." : "Loading weather…"}</p>}
        <ClockRows tz={tz} />
        <div className="loc">
          <MapPin size={14} aria-hidden="true" /><span className="pl">{place}</span>
          {!precise && <span className="loctag">{gps?.err || "approx."}</span>}
        </div>
        {gps !== "loading" && (
          <button type="button" className="btn gh sm" onClick={locate}>
            <LocateFixed size={14} aria-hidden="true" />{precise ? "Refresh precise location" : "Use precise location"}
          </button>
        )}
        {gps === "loading" && <p className="hint">Locating precisely…</p>}
        <p className="hint">Shown only to you. Coordinates are never stored.</p>
      </div>
    </details>
  );
}
