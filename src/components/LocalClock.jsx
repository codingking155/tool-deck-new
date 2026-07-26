import { useState } from "react";
import { pad, zoneParts } from "../lib/time.js";
import { useIpLocale } from "../hooks/index.js";

/* Local time + location per user's IP: tries an IP-geo lookup, falls back to
   the device timezone. IP city is approximate; the "Precise" button uses
   browser GPS (with permission) for the exact city. */
export default function LocalClock({ now }) {
  const ipd = useIpLocale();
  const [gps, setGps] = useState(null); // null | "loading" | {ok,city,area,region,country} | {err}
  const tz = ipd.tz;
  const p = zoneParts(now, tz);
  const tzCity = tz.split("/").pop().replace(/_/g, " ");

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

  let locLine;
  if (gps === "loading") locLine = <span>📍 Locating precisely…</span>;
  else if (gps && gps.ok) locLine = <span>📍 <b>{gps.area ? `${gps.area}, ` : ""}{gps.city}</b>{gps.region ? `, ${gps.region}` : ""} <span className="loctag ok">precise</span></span>;
  else if (gps && gps.err) locLine = <span>📍 {ipd.city ? <><b>{ipd.city}</b>{ipd.region ? `, ${ipd.region}` : ""}</> : tzCity} <span className="loctag">{gps.err}</span></span>;
  else if (ipd.city) locLine = <span>📍 <b>{ipd.city}</b>{ipd.region ? `, ${ipd.region}` : ""} <span className="loctag">from IP · approx.</span></span>;
  else locLine = <span>📍 {tzCity} <span className="loctag">approx. · from timezone</span></span>;

  return (
    <div className="uclock loc" title={`Your local time — ${tz} (${ipd.src === "ip" ? "detected from your IP" : "from your device"}). Location is shown only to you and never stored.`}>
      <div className="lrow trow">🕐 <b>{pad(p.hour)}:{pad(p.minute)}:{pad(p.second)}</b><span style={{ opacity: 0.6, fontSize: 10.5 }}>{tzCity}</span></div>
      <div className="lrow">{locLine}
        {!(gps && gps.ok) && gps !== "loading" && <button className="pinbtn" onClick={locate} title="Use your device's GPS for the exact city (asks permission; nothing is stored)">🎯 Precise</button>}
      </div>
    </div>
  );
}
