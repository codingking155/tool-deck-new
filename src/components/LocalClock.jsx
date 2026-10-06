import { useState, useEffect, useRef } from "react";
import { MapPin, LocateFixed } from "lucide-react";
import { pad, zoneParts, fmtUtc } from "../lib/time.js";
import { useIpLocale } from "../hooks/index.js";

/* Header clock: local time + UTC in one compact control; location detail opens on demand.
   Local zone/city come from an IP-geo lookup (falls back to the device timezone);
   "Use precise location" asks for browser GPS. Location is shown only to the user and never stored. */
export default function LocalClock({ now }) {
  const ipd = useIpLocale();
  const [gps, setGps] = useState(null); // null | "loading" | {ok,city,area,region,country} | {err}
  const ref = useRef(null);
  const tz = ipd.tz;
  const p = zoneParts(now, tz);
  const tzCity = tz.split("/").pop().replace(/_/g, " ");

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
        try {
          const { latitude, longitude } = pos.coords;
          const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`)).json();
          const city = j.city || j.locality || "";
          const area = j.locality && city && j.locality !== city ? j.locality : "";
          if (city) setGps({ ok: true, city, area, region: j.principalSubdivision || "", country: j.countryName || "" });
          else setGps({ err: "Couldn't resolve a city" });
        } catch { setGps({ err: "Lookup blocked (works when deployed)" }); }
      },
      (e) => setGps({ err: e && e.code === 1 ? "Permission denied" : "Location unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  let place, tag;
  if (gps === "loading") { place = "Locating precisely…"; tag = null; }
  else if (gps && gps.ok) { place = `${gps.area ? `${gps.area}, ` : ""}${gps.city}${gps.region ? `, ${gps.region}` : ""}`; tag = <span className="loctag ok">precise</span>; }
  else if (ipd.city) { place = `${ipd.city}${ipd.region ? `, ${ipd.region}` : ""}`; tag = <span className="loctag">{gps?.err || "approx. · from IP"}</span>; }
  else { place = tzCity; tag = <span className="loctag">{gps?.err || "approx. · from timezone"}</span>; }

  /* short view names the detected place (GPS city, else IP city), falling back to the zone city */
  const shortPlace = (gps && gps.ok && gps.city) || ipd.city || tzCity;
  const local = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  const utc = fmtUtc(now);
  return (
    <details className="clk" ref={ref}>
      <summary aria-label={`Local time ${local} ${shortPlace}, UTC ${utc}. Show location details`}>
        <span className="t-loc">{local}<small>{shortPlace.toUpperCase()}</small></span>
        <span className="t-sep" aria-hidden="true" />
        <span className="t-utc">{utc}<small>UTC</small></span>
      </summary>
      <div className="clk-pop">
        <div className="row"><span>Local</span><b>{local}</b></div>
        <div className="row"><span>UTC</span><b>{utc}</b></div>
        <div className="row"><span>Time zone</span><b>{tz}</b></div>
        <div className="loc"><MapPin size={14} aria-hidden="true" /><span className="pl">{place}</span>{tag}</div>
        {!(gps && gps.ok) && gps !== "loading" && (
          <button type="button" className="btn gh sm" onClick={locate}>
            <LocateFixed size={14} aria-hidden="true" />Use precise location
          </button>
        )}
        <p className="hint">Shown only to you. Nothing is stored.</p>
      </div>
    </details>
  );
}
