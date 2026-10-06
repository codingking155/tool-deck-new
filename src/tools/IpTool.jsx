import { useState, useMemo, useEffect, useRef, useId } from "react";
import { Check, Minus, RotateCw, ChevronDown, Network, MapPin, Clock, Monitor } from "lucide-react";
import IpLeakPanel, { DiagStatus } from "./IpLeakPanel.jsx";
import { Notice, StatusBadge, CopyButton, describeError } from "../components/ui.jsx";
import "./css/ip.css";

function parseUA() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown";
  const device = /Mobi|Android|iPhone/.test(ua) ? "Mobile" : "Desktop";
  return { browser, os, device };
}

/* read-only facts the browser already knows — nothing leaves the page */
function localFacts() {
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* very old browsers */ }
  const c = typeof navigator !== "undefined" ? navigator.connection : null;
  return { tz, effective: c?.effectiveType || null, lang: typeof navigator !== "undefined" ? navigator.language : null };
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

const Na = () => <span className="ipt-na">Unavailable</span>;

function Fact({ icon: Icon, k, children, loading }) {
  return (
    <div className="kv ipt-fact">
      <span className="k"><Icon size={14} aria-hidden="true" />{k}</span>
      <span className="v">{loading ? <span className="skel ipt-sk-v" /> : (children || <Na />)}</span>
    </div>
  );
}

function HeroIp({ st, v4, v6, notify }) {
  if (st === "loading") return (
    <div className="ipt-ipblock" aria-hidden="true">
      <span className="skel ipt-sk-ip" />
      <span className="skel ipt-sk-alt" />
    </div>
  );
  if (st === "blocked") return <div className="ipt-ipblock"><p className="ipt-ip is-na">Unavailable</p></div>;
  const primary = v4 || v6;
  const pv = v4 ? "IPv4" : "IPv6";
  return (
    <div className="ipt-ipblock">
      <div className="ipt-iprow">
        <span className="ipt-ip mono">{primary}</span>
        <span className="ipt-ver">{pv}</span>
      </div>
      <div className="ipt-iprow alt">
        {v4 && v6
          ? <><span className="ipt-ver">IPv6</span><span className="ipt-alt mono">{v6}</span></>
          : <span className="ipt-alt-none">{v4 ? "No IPv6 address on this connection" : "No IPv4 address detected"}</span>}
      </div>
      <div className="actions ipt-copy">
        <CopyButton text={primary} label={`Copy ${pv}`} className="btn sm" notify={notify} toast={`${pv} address copied.`} />
        {v4 && v6 && <CopyButton text={v6} label="Copy IPv6" className="btn gh sm" notify={notify} toast="IPv6 address copied." />}
      </div>
    </div>
  );
}

function Availability({ st, v4, v6 }) {
  if (st === "loading") return <div className="ipt-badges" aria-hidden="true"><span className="skel ipt-sk-badge" /><span className="skel ipt-sk-badge" /></div>;
  if (st === "blocked") return (
    <div className="ipt-badges"><StatusBadge>IPv4 unknown</StatusBadge><StatusBadge>IPv6 unknown</StatusBadge></div>
  );
  return (
    <div className="ipt-badges">
      {v4 ? <StatusBadge tone="ok" icon={Check}>IPv4 available</StatusBadge> : <StatusBadge icon={Minus}>IPv4 not detected</StatusBadge>}
      {v6 ? <StatusBadge tone="ok" icon={Check}>IPv6 available</StatusBadge> : <StatusBadge icon={Minus}>IPv6 unavailable</StatusBadge>}
      {v4 && v6 && <StatusBadge tone="info">Dual stack</StatusBadge>}
    </div>
  );
}

function TipList({ tips, openTip, setOpenTip, mine }) {
  const uid = useId().replace(/:/g, "");
  return (
    <ul className="ipt-tips">
      {tips.map(([k, v]) => {
        const open = openTip === k;
        return (
          <li key={k} className={open ? "open" : ""}>
            <button type="button" className="ipt-tip" onClick={() => setOpenTip(open ? null : k)} aria-expanded={open} aria-controls={`${uid}-${k.replace(/\W/g, "")}`}>
              <span className="tn">{k}</span>
              {k === mine && <StatusBadge tone="brand">Your device</StatusBadge>}
              <ChevronDown size={16} aria-hidden="true" className="chev" />
            </button>
            <div className="ipt-tipbody" id={`${uid}-${k.replace(/\W/g, "")}`} hidden={!open}>{v}</div>
          </li>
        );
      })}
    </ul>
  );
}

export default function IpTool({ notify }) {
  const [st, setSt] = useState("loading");
  const [v4, setV4] = useState(null);
  const [v6, setV6] = useState(null);
  const [geo, setGeo] = useState(null);
  const [openTip, setOpenTip] = useState(null);
  const ua = useMemo(parseUA, []);
  const local = useMemo(localFacts, []);
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
    const tip = OS_TIP[ua.os];
    setOpenTip(!ip6 && tip ? tip : null);
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* the user's own platform first, then the rest */
  const mine = OS_TIP[ua.os];
  const tips = useMemo(() => [...IPV6_TIPS].sort((x, y) => (y[0] === mine) - (x[0] === mine)), [mine]);
  const loading = st === "loading";
  const done = st === "done";
  const v6on = !!v6;
  const where = geo && [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
  const err = st === "blocked" ? describeError(new Error("Failed to fetch"), { service: "the IP lookup services" }) : null;
  const tzDiffers = geo?.tz && local.tz && geo.tz !== local.tz;
  const v6Status = loading ? "busy" : st === "blocked" ? "unknown" : v6on ? "safe" : "na";

  return (
    <div className="ipt">
      <section className="panel ipt-hero" aria-labelledby="ipt-hero-h" aria-busy={loading}>
        <div className="ipt-hero-grid">
          <div className="ipt-hero-main">
            <h2 id="ipt-hero-h" className="eyebrow">Your public IP</h2>
            <HeroIp st={st} v4={v4} v6={v6} notify={notify} />
            <Availability st={st} v4={v4} v6={v6} />
          </div>
          <div className="ipt-facts">
            {st === "blocked"
              ? <Notice tone="off" title={err.title}
                  actions={<button type="button" className="btn sm" onClick={check}><RotateCw size={14} aria-hidden="true" />Try again</button>}>
                  {err.hint} A content blocker, firewall or strict privacy setting can also stop these lookups.
                </Notice>
              : <>
                <Fact icon={Network} k="ISP / network" loading={loading}>
                  {geo && (geo.org || geo.asn) ? [geo.org, geo.asn].filter(Boolean).join(" · ") : null}
                </Fact>
                <Fact icon={MapPin} k="Approx. location" loading={loading}>{where || null}</Fact>
                <Fact icon={Clock} k="IP time zone" loading={loading}>{geo?.tz || null}</Fact>
                {done && !geo && <p className="hint">The ISP and location lookup is unavailable right now — your addresses above are unaffected.</p>}
              </>}
          </div>
        </div>
        <div className="ipt-hero-foot">
          <p className="hint">Location is estimated from the public IP and can be far from where you actually are. This page does not store your address.</p>
          {!loading && st !== "blocked" && (
            <button type="button" className="btn gh sm" onClick={check}><RotateCw size={14} aria-hidden="true" />Re-check</button>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {loading ? "" : st === "blocked" ? err.title : `Public IP found${v6on ? ", IPv6 available" : ", IPv6 unavailable"}.`}
        </p>
      </section>

      <div className="ipt-diag">
        <section className="panel ipt-sec" aria-labelledby="ipt-v6-h">
          <div className="ipt-sechead">
            <h2 id="ipt-v6-h">IPv6 support</h2>
            <DiagStatus s={v6Status} label={v6on ? "Working" : undefined} />
          </div>
          <div className="pb">
            {loading && <div className="ipt-skblock" aria-hidden="true"><span className="skel" /><span className="skel" /></div>}
            {done && v6on && (
              <Notice tone="ok" title={v4 ? "Working — dual stack" : "Working — IPv6 only"}>
                Sites that support IPv6 can reach you directly over it{v4 ? ", and IPv4 still works for everything else" : ""}.
              </Notice>
            )}
            {done && !v6on && (
              <Notice tone="i" title="IPv6 isn't available on this connection">
                Usually your ISP or router hasn't enabled IPv6 for your plan. A VPN or a router with IPv6 switched off can also hide it.
                Your device settings are rarely the cause — start with the router{mine ? `, then ${mine}` : ""}.
              </Notice>
            )}
            {st === "blocked" && <p className="ipt-p">IPv6 couldn't be tested because the lookup services were unreachable.</p>}
            <p className="ipt-p">
              IPv6 gives a vastly larger address space and can improve direct connectivity on compatible networks. It does not
              automatically make your internet faster — availability depends on your ISP, router and device.
            </p>
            <h3 className="ipt-h3">How to enable IPv6</h3>
            <TipList tips={tips} openTip={openTip} setOpenTip={setOpenTip} mine={mine} />
          </div>
        </section>

        <section className="panel ipt-sec" aria-labelledby="ipt-br-h">
          <div className="ipt-sechead">
            <h2 id="ipt-br-h">Browser &amp; network details</h2>
            <span className="ipt-local"><Monitor size={13} aria-hidden="true" />Read on this device</span>
          </div>
          <div className="pb">
            <div className="kv"><span className="k">Browser</span><span className="v">{ua.browser}</span></div>
            <div className="kv"><span className="k">Operating system</span><span className="v">{ua.os}</span></div>
            <div className="kv"><span className="k">Device type</span><span className="v">{ua.device}</span></div>
            <div className="kv"><span className="k">Device time zone</span><span className="v">{local.tz || <Na />}</span></div>
            {local.lang && <div className="kv"><span className="k">Language</span><span className="v">{local.lang}</span></div>}
            {local.effective && <div className="kv"><span className="k">Connection estimate</span><span className="v">{local.effective.toUpperCase()}</span></div>}
            {tzDiffers && (
              <p className="hint">Your device's time zone differs from your IP's ({geo.tz}). That's normal on a VPN, a mobile network or while travelling.</p>
            )}
          </div>
        </section>
      </div>

      <IpLeakPanel v4={v4} v6={v6} />
    </div>
  );
}
