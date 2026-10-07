import { useState, useEffect, useRef } from "react";
import { Sun, Moon, Cloud, CloudSun, CloudMoon, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, MapPin, LocateFixed } from "lucide-react";
import { useIpLocale } from "../hooks/index.js";
import { fetchWeather, weatherKind, weatherLabel, isNight, moonPhase, moonPhaseName } from "../lib/weather.js";

const REFRESH_MS = 15 * 60 * 1000;

function WeatherIcon({ code, night }) {
  const k = weatherKind(code);
  const I = k === "clear" ? (night ? Moon : Sun) : k === "partly" ? (night ? CloudMoon : CloudSun)
    : k === "fog" ? CloudFog : k === "drizzle" ? CloudDrizzle : k === "rain" ? CloudRain
    : k === "snow" ? CloudSnow : k === "thunder" ? CloudLightning : Cloud;
  return <I size={18} aria-hidden="true" className="wx-ic" />;
}

/* Header weather chip: approximate location from IP, precise location only on click.
   Day/night comes from real sunrise/sunset, never from the site theme. Coordinates are never stored.
   Real data only — if the weather can't load, it says so. */
export default function WeatherChip() {
  const ipd = useIpLocale();
  const [gps, setGps] = useState(null); // null | "loading" | {lat,lon,city,region} | {err}
  const [wx, setWx] = useState(null); // null | {temp,code,isDay,sunrise,sunset} | {err}
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(null);

  const lat = gps?.lat ?? ipd.lat, lon = gps?.lon ?? ipd.lon;

  /* load + refresh every 15 min and on return to the tab; the 1 min tick keeps day/night current */
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    let alive = true, last = 0;
    const load = () => { last = Date.now(); fetchWeather(lat, lon).then((w) => alive && setWx(w)).catch(() => alive && setWx((p) => (p && !p.err ? p : { err: true }))); };
    load();
    const id = setInterval(load, REFRESH_MS);
    const vis = () => { if (document.visibilityState === "visible" && Date.now() - last > REFRESH_MS) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [lat, lon]);
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

  const precise = gps && Number.isFinite(gps.lat);
  const city = (precise && gps.city) || ipd.city;
  const region = (precise && gps.city && gps.region) || (!precise && ipd.region) || "";
  const place = city ? `${city}${region ? `, ${region}` : ""}` : precise ? "Precise location" : "Approximate location";
  const ok = wx && !wx.err;
  const night = ok && isNight(wx, now);
  const phase = moonPhaseName(moonPhase(now));
  const temp = ok ? `${Math.round(wx.temp)}°` : "";
  const label = ok ? weatherLabel(wx.code) : wx?.err ? "Weather unavailable" : "Loading weather";

  return (
    <details className="clk wx" ref={ref}>
      <summary aria-label={ok ? `${temp}C, ${label}, ${night ? `night, ${phase}` : "day"}${city ? `, ${city}` : ""}. Show weather details` : `${label}. Show weather details`}>
        {ok ? <WeatherIcon code={wx.code} night={night} /> : <MapPin size={16} aria-hidden="true" className="wx-ic" />}
        {ok && <span className="t-loc">{temp}</span>}
        <span className="wx-lbl">{label}</span>
      </summary>
      <div className="clk-pop">
        <div className="row"><span>Location</span><b>{place}</b></div>
        {ok && <div className="row"><span>Now</span><b>{temp}C · {label}</b></div>}
        {ok && <div className="row"><span>Sky</span><b>{night ? `Night · ${phase}` : "Daytime"}</b></div>}
        <div className="loc">
          <MapPin size={14} aria-hidden="true" /><span className="pl">{place}</span>
          {precise ? <span className="loctag ok">precise</span> : <span className="loctag">{gps?.err || "approx. · from IP"}</span>}
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
