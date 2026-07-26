import { useState, useMemo } from "react";

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

export default function IpTool() {
  const [st, setSt] = useState("idle");
  const [v4, setV4] = useState(null);
  const [v6, setV6] = useState(null);
  const [geo, setGeo] = useState(null);
  const [demo, setDemo] = useState(false);
  const [openTip, setOpenTip] = useState(-1);
  const ua = useMemo(parseUA, []);
  const tryJson = async (u) => { try { const r = await fetch(u, { cache: "no-store" }); return await r.json(); } catch { return null; } };
  const check = async () => {
    setSt("loading"); setV4(null); setV6(null); setGeo(null); setDemo(false);
    let any = false;
    const j = await tryJson("https://ipapi.co/json/");
    if (j && !j.error && j.ip) { if (j.ip.includes(":")) setV6(j.ip); else setV4(j.ip); setGeo(j); any = true; }
    const j4 = await tryJson("https://api.ipify.org?format=json");
    if (j4 && j4.ip) { setV4((p) => p || j4.ip); any = true; }
    const j6 = await tryJson("https://api64.ipify.org?format=json");
    if (j6 && j6.ip && j6.ip.includes(":")) { setV6(j6.ip); any = true; }
    else if (j6 && j6.ip && !any) { setV4((p) => p || j6.ip); any = true; }
    if (!any) {
      const jw = await tryJson("https://ipwho.is/");
      if (jw && jw.success !== false && jw.ip) {
        if (jw.ip.includes(":")) setV6(jw.ip); else setV4(jw.ip);
        setGeo({ org: jw.connection && jw.connection.isp, city: jw.city, region: jw.region, country_name: jw.country });
        any = true;
      }
    }
    setSt(any ? "done" : "blocked");
  };
  const fillDemo = () => {
    setV4("103.211.20.14"); setV6("2405:201:6014:d0d1:a1b2:c3d4:e5f6:7788");
    setGeo({ org: "Sample Broadband Pvt Ltd", city: "Bengaluru", region: "Karnataka", country_name: "India" });
    setDemo(true); setSt("done");
  };
  const v6on = !!v6;
  return (
    <div className="grid2">
      <div className="panel rise d1">
        <div className="ph"><h3>Your connection</h3><p>Public addresses are read from the network — nothing is stored.</p></div>
        <div className="pb">
          {st === "idle" && <button className="btn pri" onClick={check}>Check my IP & IPv6</button>}
          {st === "loading" && <><div className="skel" style={{ height: 44, marginBottom: 10 }} /><div className="skel" style={{ height: 44, marginBottom: 10 }} /><div className="skel" style={{ height: 44 }} /></>}
          {st === "blocked" && <div className="empty" style={{ textAlign: "left" }}>
            IP lookup endpoints are unreachable here (sandboxed previews block them). When you deploy or open the site
            directly, this panel fills in automatically.
            <div className="kv" style={{ padding: "12px 0 0", borderBottom: 0 }}><span className="k">Browser / OS</span><span className="v">{ua.browser} · {ua.os} · {ua.device}</span></div>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}><button className="btn gh" onClick={check}>Retry</button><button className="btn gh" onClick={fillDemo}>Show a sample result</button></div>
          </div>}
          {st === "done" && (
            <>
              {demo && <div style={{ marginBottom: 12 }}><span className="chip wk">SAMPLE DATA — NOT YOUR REAL IP</span></div>}
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">Public IPv4</span><span className="v hl">{v4 || "Not detected"}</span></div>
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">Public IPv6</span><span className="v hl">{v6 || "Not detected"}</span></div>
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">IPv6 enabled</span><span className="v" style={{ color: v6on ? "var(--good)" : "var(--warn)" }}>{v6on ? "✓ Yes — dual stack" : "✗ No"}</span></div>
              {geo && <>
                <div className="kv" style={{ padding: "10px 0" }}><span className="k">ISP / Org</span><span className="v">{geo.org || "—"}</span></div>
                <div className="kv" style={{ padding: "10px 0" }}><span className="k">Approx. location</span><span className="v">{[geo.city, geo.region, geo.country_name].filter(Boolean).join(", ")}</span></div>
              </>}
              <div className="kv" style={{ padding: "10px 0" }}><span className="k">Browser / OS</span><span className="v">{ua.browser} · {ua.os} · {ua.device}</span></div>
              <div className="note i" style={{ marginTop: 12 }}>Location is estimated from the public IP and can be far from where you actually are. This page does not store your address.</div>
            </>
          )}
        </div>
      </div>
      <div className="panel rise d2">
        <div className="ph"><h3>{st === "done" && !v6 ? "IPv6 is off — how to enable it" : "About IPv6"}</h3></div>
        <div className="pb">
          <div className="note i"><b>The honest version · </b>IPv6 gives a vastly larger address space and can improve direct
            connectivity on compatible networks. It does not automatically make your internet faster — availability depends on
            your ISP, router and device.</div>
          {IPV6_TIPS.map(([k, v], i) => (
            <div key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
              <button className="cpitem" style={{ padding: "11px 4px" }} onClick={() => setOpenTip(openTip === i ? -1 : i)} aria-expanded={openTip === i}>
                <b style={{ fontSize: 13.5 }}>{k}</b><span className="d">{openTip === i ? "−" : "+"}</span>
              </button>
              {openTip === i && <div className="hint" style={{ padding: "0 4px 12px" }}>{v}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
