import { useState, useMemo, useEffect, useRef } from "react";
import IpLeakPanel from "./IpLeakPanel.jsx";
import { copyText } from "../components/chrome.jsx";

function parseUA() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown";
  const device = /Mobi|Android|iPhone/.test(ua) ? "Mobile" : "Desktop";
  return { browser, os, device };
}

const IPV6_TIPS = [
  ["Android", "Settings → Network → your APN → set APN protocol to IPv4/IPv6. Jio and Airtel enable it by default on most plans."],
  ["iPhone", "IPv6 is automatic when the carrier or Wi-Fi supports it — no toggle. Update iOS and reboot after changing networks."],
  ["Windows", "Settings → Network → Adapter options → your adapter → Properties → tick 'Internet Protocol Version 6 (TCP/IPv6)'."],
  ["macOS", "System Settings → Network → your connection → Details → TCP/IP → Configure IPv6: Automatically."],
  ["Wi-Fi router", "Router admin page → Internet/WAN settings → enable IPv6 (usually DHCPv6 or SLAAC). Update the firmware first."],
  ["Indian ISPs", "Jio, Airtel and ACT support IPv6 widely; BSNL varies by region. Ask support to enable dual-stack on your plan."],
];
const OS_TIP = { Android: "Android", iOS: "iPhone", Windows: "Windows", macOS: "macOS" };

/* each lookup gets its own timeout (body included): a hanging endpoint must not leave the panel loading forever */
async function getJson(url, ms = 5000) {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/* ISP/location: ipapi.co first, ipwho.is if it's rate-limited or blocked. Normalised to one shape. */
async function lookupGeo() {
  const a = await getJson("https://ipapi.co/json/");
  if (a && !a.error && a.ip) {
    return { ip: a.ip, org: a.org, asn: a.asn, city: a.city, region: a.region, country: a.country_name, tz: a.timezone };
  }
  const w = await getJson("https://ipwho.is/");
  if (w && w.success !== false && w.ip) {
    const c = w.connection || {};
    return { ip: w.ip, org: c.isp || c.org, asn: c.asn ? `AS${c.asn}` : null, city: w.city, region: w.region, country: w.country, tz: w.timezone && w.timezone.id };
  }
  return null;
}

function Row({ k, children, copy, notify }) {
  return (
    <div className="kv" style={{ padding: "10px 0", alignItems: "center", gap: 10 }}>
      <span className="k">{k}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span className="v hl" style={{ overflowWrap: "anywhere", textAlign: "right" }}>{children}</span>
        {copy && <button className="pill" style={{ minHeight: 28, padding: "3px 9px" }} onClick={() => copyText(copy, notify, `${k} copied.`)} aria-label={`Copy ${k}`}>Copy</button>}
      </span>
    </div>
  );
}

export default function IpTool({ notify }) {
  const [st, setSt] = useState("loading");
  const [v4, setV4] = useState(null);
  const [v6, setV6] = useState(null);
  const [geo, setGeo] = useState(null);
  const [openTip, setOpenTip] = useState(-1);
  const ua = useMemo(parseUA, []);
  const run = useRef(0);

  const check = async () => {
    const id = ++run.current;
    setSt("loading"); setV4(null); setV6(null); setGeo(null);
    /* api.ipify.org has only an A record and api6.ipify.org only AAAA, so each one answers over exactly
       that protocol. That's a real IPv6 test — a dual-stack host would let the browser fall back to IPv4. */
    const [a4, a6, g] = await Promise.all([
      getJson("https://api.ipify.org?format=json"),
      getJson("https://api6.ipify.org?format=json", 6000),
      lookupGeo(),
    ]);
    if (id !== run.current) return;
    let ip4 = a4 && a4.ip && !a4.ip.includes(":") ? a4.ip : null;
    let ip6 = a6 && a6.ip && a6.ip.includes(":") ? a6.ip : null;
    if (g && g.ip) { if (g.ip.includes(":")) ip6 = ip6 || g.ip; else ip4 = ip4 || g.ip; }
    setV4(ip4); setV6(ip6); setGeo(g);
    setSt(ip4 || ip6 ? "done" : "blocked");
    const tip = IPV6_TIPS.findIndex(([k]) => k === OS_TIP[ua.os]);
    setOpenTip(!ip6 && tip >= 0 ? tip : -1);
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* the user's own platform first, then the rest */
  const tips = useMemo(() => {
    const mine = OS_TIP[ua.os];
    return [...IPV6_TIPS].sort((x, y) => (y[0] === mine) - (x[0] === mine));
  }, [ua.os]);
  const tipIndex = (k) => IPV6_TIPS.findIndex(([n]) => n === k);
  const v6on = !!v6;
  const where = geo && [geo.city, geo.region, geo.country].filter(Boolean).join(", ");

  return (
    <>
    <div className="grid2">
      <div className="panel rise d1">
        <div className="ph"><h2>Your connection</h2><p>Public addresses are read from the network — nothing is stored.</p></div>
        <div className="pb">
          {st === "loading" && <><div className="skel" style={{ height: 44, marginBottom: 10 }} /><div className="skel" style={{ height: 44, marginBottom: 10 }} /><div className="skel" style={{ height: 44 }} /></>}
          {st === "blocked" && <div className="empty" style={{ textAlign: "left" }}>
            Couldn't reach the IP lookup services. A content blocker, firewall or offline connection is the usual cause.
            <div className="kv" style={{ padding: "12px 0 0", borderBottom: 0 }}><span className="k">Browser / OS</span><span className="v">{ua.browser} · {ua.os} · {ua.device}</span></div>
            <div style={{ marginTop: 14 }}><button className="btn gh" onClick={check}>Retry</button></div>
          </div>}
          {st === "done" && (
            <>
              <Row k="Public IPv4" copy={v4} notify={notify}>{v4 || "Not detected"}</Row>
              <Row k="Public IPv6" copy={v6} notify={notify}>{v6 || "Not detected"}</Row>
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">IPv6</span>
                <span className="v" style={{ color: v6on ? "var(--good)" : "var(--warn)" }}>{v6on ? (v4 ? "✓ Working — dual stack" : "✓ Working — IPv6 only") : "✗ Not available on this connection"}</span></div>
              {geo && <>
                <div className="kv" style={{ padding: "10px 0" }}><span className="k">ISP / Org</span><span className="v">{geo.org || "—"}{geo.asn ? ` · ${geo.asn}` : ""}</span></div>
                {where && <div className="kv" style={{ padding: "10px 0" }}><span className="k">Approx. location</span><span className="v">{where}</span></div>}
                {geo.tz && <div className="kv" style={{ padding: "10px 0" }}><span className="k">IP time zone</span><span className="v">{geo.tz}</span></div>}
              </>}
              {!geo && <div className="kv" style={{ padding: "10px 0" }}><span className="k">ISP / location</span><span className="v" style={{ color: "var(--tx2)" }}>Lookup unavailable right now</span></div>}
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">Browser / OS</span><span className="v">{ua.browser} · {ua.os} · {ua.device}</span></div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn gh" onClick={check}>Re-check</button>
              </div>
              <div className="note i" style={{ marginTop: 12 }}>Location is estimated from the public IP and can be far from where you actually are. This page does not store your address.</div>
            </>
          )}
        </div>
      </div>
      <div className="panel rise d2">
        <div className="ph"><h2>{st === "done" ? (v6on ? "IPv6 is working" : "IPv6 is off — how to enable it") : "About IPv6"}</h2></div>
        <div className="pb">
          {st === "done" && !v6on && <div className="note w" style={{ marginBottom: 12 }}>
            <b>Why it's off · </b>usually your ISP or router hasn't enabled IPv6 for your plan. A VPN or a router with IPv6
            switched off can also hide it. Your device settings are rarely the cause — start with the router{OS_TIP[ua.os] ? `, then ${OS_TIP[ua.os]}` : ""}.
          </div>}
          <div className="note i"><b>The honest version · </b>IPv6 gives a vastly larger address space and can improve direct
            connectivity on compatible networks. It does not automatically make your internet faster — availability depends on
            your ISP, router and device.</div>
          {tips.map(([k, v]) => {
            const i = tipIndex(k);
            const mine = k === OS_TIP[ua.os];
            return (
              <div key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
                <button className="cpitem" style={{ padding: "11px 4px" }} onClick={() => setOpenTip(openTip === i ? -1 : i)} aria-expanded={openTip === i}>
                  <b style={{ fontSize: 13.5 }}>{k}{mine && <span className="chip up" style={{ marginLeft: 8 }}>YOUR DEVICE</span>}</b><span className="d">{openTip === i ? "−" : "+"}</span>
                </button>
                {openTip === i && <div className="hint" style={{ padding: "0 4px 12px" }}>{v}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    <IpLeakPanel v4={v4} v6={v6} />
    </>
  );
}
