import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import {
  availableServers, runFullTest, fetchMeta,
  compareRuns, qualityLabels,
} from "../lib/speed.js";

/* ────────────────────────────────────────────────────────────────────────────
   SPEEDOMETER — speedtest-style 270° gauge; needle driven by a time-based rAF spring
   ──────────────────────────────────────────────────────────────────────────── */

/* piecewise scale like speedtest.net: every labelled step gets an equal slice of
   the 270° sweep, which starts at 135° (lower-left) and ends at 45° (lower-right) */
const G_TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
const G_SWEEP = 270, G_START = 135, G_SEG = G_SWEEP / (G_TICKS.length - 1);

function gaugeAngle(v) {
  if (!v || v <= 0) return 0;
  if (v >= G_TICKS[G_TICKS.length - 1]) return G_SWEEP;
  const i = G_TICKS.findIndex((t) => t > v) - 1;
  return (i + (v - G_TICKS[i]) / (G_TICKS[i + 1] - G_TICKS[i])) * G_SEG;
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const fmtMbps = (v) => (v >= 100 ? v.toFixed(1) : v.toFixed(2));

const Speedometer = ({ mbps, phase, label }) => {
  const uid = useId().replace(/:/g, "");
  const angleGoal = gaugeAngle(mbps ?? 0);
  const valueGoal = mbps != null && mbps > 0 ? mbps : 0;
  const [view, setView] = useState({ a: 0, v: 0 });
  const sim = useRef({ a: 0, vel: 0, v: 0, last: 0, raf: 0 });
  const goal = useRef({ a: angleGoal, v: valueGoal });
  goal.current = { a: angleGoal, v: valueGoal };

  /* the loop only runs while the needle is moving — it stops once settled and
     restarts (keeping its velocity) whenever a new sample arrives */
  useEffect(() => {
    const s = sim.current;
    if (reducedMotion()) {
      s.a = angleGoal; s.v = valueGoal; s.vel = 0;
      setView({ a: angleGoal, v: valueGoal });
      return;
    }
    s.last = 0;
    const step = (now) => {
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 1 / 60;
      s.last = now;
      const g = goal.current;
      /* near-critically damped (ζ≈0.85): snappy like a real test needle, only a hint of settle */
      const w = 10, z = 0.85;
      s.vel += (w * w * (g.a - s.a) - 2 * z * w * s.vel) * dt;
      s.a += s.vel * dt;
      /* readout eases without overshoot so the number never shows a value that wasn't measured */
      s.v += (g.v - s.v) * (1 - Math.exp(-dt / 0.14));
      const settled = Math.abs(g.a - s.a) < 0.05 && Math.abs(s.vel) < 0.05 && Math.abs(g.v - s.v) < 0.002;
      if (settled) { s.a = g.a; s.vel = 0; s.v = g.v; }
      setView({ a: s.a, v: s.v });
      s.raf = settled ? 0 : requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(s.raf);
  }, [angleGoal, valueGoal]);

  const shown = Math.min(G_SWEEP, Math.max(0, view.a));
  const up = phase === "up";
  const cx = 150, cy = 150, r = 120, tw = 26, rin = r - tw / 2;   // track centre radius / width / inner edge
  const pt = (deg, rad) => {
    const a = ((G_START + deg) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const arc = (deg, rad) => {
    const [x0, y0] = pt(0, rad), [x1, y1] = pt(Math.max(0.01, deg), rad);
    return `M ${x0} ${y0} A ${rad} ${rad} 0 ${deg > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [sx0, sy0] = pt(0, rin), [sx1, sy1] = pt(Math.max(0.01, shown), rin);
  const sweep = `M ${cx} ${cy} L ${sx0} ${sy0} A ${rin} ${rin} 0 ${shown > 180 ? 1 : 0} 1 ${sx1} ${sy1} Z`;

  return (
    <div className={`spd-wrap ${up ? "up" : "down"}`} role="img"
      aria-label={`${label}: ${mbps == null ? "unavailable" : `${mbps.toFixed(1)} megabits per second`}`}>
      {/* viewBox covers the full arc incl. stroke (y 17…244), every label and the readout */}
      <svg viewBox="0 10 300 240" className="spd-svg">
        <defs>
          <linearGradient id={`${uid}f`} gradientUnits="userSpaceOnUse" x1="40" y1="250" x2="260" y2="20">
            <stop offset="0" className="spd-ga" /><stop offset="1" className="spd-gb" />
          </linearGradient>
          <radialGradient id={`${uid}s`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={rin}>
            <stop offset="0.45" className="spd-gb" stopOpacity="0" />
            <stop offset="1" className="spd-gb" stopOpacity="0.22" />
          </radialGradient>
          {/* defined in the needle's own (rotated) space: transparent at the hub, solid at the tip */}
          <linearGradient id={`${uid}n`} gradientUnits="userSpaceOnUse" x1={cx + 30} y1={cy} x2={cx + rin - 8} y2={cy}>
            <stop offset="0" className="spd-nd" stopOpacity="0" />
            <stop offset="1" className="spd-nd" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path d={arc(G_SWEEP, r)} className="spd-track" fill="none" strokeWidth={tw} />
        {view.a > 0.2 && <path d={sweep} fill={`url(#${uid}s)`} />}
        <path d={arc(Math.max(0.3, shown), r)} className="spd-fill" fill="none" strokeWidth={tw} stroke={`url(#${uid}f)`} />
        {G_TICKS.map((v, i) => {
          const [tx, ty] = pt(i * G_SEG, rin - 20);
          const on = view.v > 0 && i * G_SEG <= shown + 0.5;
          return (
            <text key={v} x={tx} y={ty} textAnchor="middle" dominantBaseline="central" className={`spd-tick${on ? " on" : ""}`}>{v}</text>
          );
        })}
        <g transform={`rotate(${G_START + shown} ${cx} ${cy})`}>
          <polygon fill={`url(#${uid}n)`}
            points={`${cx + 30},${cy - 1.5} ${cx + rin - 8},${cy - 6} ${cx + rin - 8},${cy + 6} ${cx + 30},${cy + 1.5}`} />
        </g>
        <text x={cx} y={cy + 32} textAnchor="middle" dominantBaseline="central" className="spd-num">
          {mbps == null ? "—" : fmtMbps(view.v)}
        </text>
      </svg>
      <div className="spd-read" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="spd-ico">
          <circle cx="8" cy="8" r="7" fill="none" strokeWidth="1.4" />
          <path d={up ? "M8 11.5V4.5M5 7.5l3-3 3 3" : "M8 4.5v7M5 8.5l3 3 3-3"} fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Mbps · {label}</span>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   LIVE THROUGHPUT GRAPH — Real-time SVG polyline from timestamped samples
   ──────────────────────────────────────────────────────────────────────────── */

function LiveGraph({ series, color, label }) {
  if (!series || series.length < 2) return null;

  const w = 280, h = 56;
  const maxT = series[series.length - 1].t || 1;
  const maxM = Math.max(...series.map((s) => s.mbps), 1);

  const pts = series
    .map((s) => `${(s.t / maxT * w).toFixed(1)},${(h - 4 - (s.mbps / maxM) * (h - 10)).toFixed(1)}`)
    .join(" ");

  return (
    <div className="spd-graph" style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" style={{ width: "100%", height: 60 }}
        aria-label={`${label} throughput over time, peaking at ${maxM.toFixed(1)} megabits per second`}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="hint" style={{ fontSize: 11, display: "block", marginTop: 4 }}>{label} · peak {maxM.toFixed(1)} Mbps</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   IP CLASSIFICATION — Dynamic vs Static Detection
   ──────────────────────────────────────────────────────────────────────────── */

/* Observations are stored as a one-way fingerprint of the address (never the IP
   itself), so the page's "isn't stored" promise holds while visits stay comparable. */
const IP_OBS_KEY = "td-speed-ip-obs-v2";
const IP_OBS_LEGACY_KEY = "td-speed-ip-obs";

function ipFingerprint(ip) {
  let h = 0x811c9dc5;                                 // FNV-1a 32-bit
  for (let i = 0; i < ip.length; i++) { h ^= ip.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function loadIpObservations() {
  try {
    const cur = JSON.parse(localStorage.getItem(IP_OBS_KEY));
    if (Array.isArray(cur)) return cur;
    /* one-time migration from the raw-IP format: fingerprint, keep history, drop the raw copy */
    const legacy = JSON.parse(localStorage.getItem(IP_OBS_LEGACY_KEY)) || [];
    const migrated = legacy.filter((o) => o && o.ip && o.iso).map((o) => ({ h: ipFingerprint(o.ip), iso: o.iso }));
    localStorage.setItem(IP_OBS_KEY, JSON.stringify(migrated));
    localStorage.removeItem(IP_OBS_LEGACY_KEY);
    return migrated;
  } catch { return []; }
}

/* one entry per address per hour — reloads and StrictMode double-mounts shouldn't count as evidence */
function recordIpObservation(obs, ip) {
  const h = ipFingerprint(ip), now = Date.now();
  if (obs[0] && obs[0].h === h && now - new Date(obs[0].iso).getTime() < 3600000) return obs;
  return [{ h, iso: new Date(now).toISOString() }, ...obs].slice(0, 100);
}

/** Static vs dynamic from this device's own history — a browser can't ask the ISP,
    so it only ever reports what the evidence supports. Always returns a valid state. */
function classifyIp(currentIp, observations = []) {
  if (!currentIp) return { state: "Unknown", detail: "No public IP was detected in this session." };
  const seen = observations.filter((o) => o && o.h && o.iso);
  const distinct = new Set([ipFingerprint(currentIp), ...seen.map((o) => o.h)]);
  if (distinct.size > 1) return {
    state: "Likely dynamic",
    detail: `This device has seen ${distinct.size} different public addresses over time.`,
  };
  if (seen.length < 2) return {
    state: "Unknown",
    detail: "Not enough history yet — revisit over a few days to compare addresses.",
  };
  const days = (Date.now() - new Date(seen[seen.length - 1].iso).getTime()) / 86400000;
  if (days >= 7) return {
    state: "Likely static",
    detail: `Same address for ${Math.round(days)} days. Only your ISP can confirm a static assignment.`,
  };
  return {
    state: "Likely dynamic",
    detail: "Unchanged so far, but observed for under a week — most consumer connections are dynamic.",
  };
}

function maskIp(ip) {
  if (!ip) return null;
  if (ip.includes(":")) {
    const p = ip.split(":");
    return p.slice(0, 3).join(":") + "::…";
  }
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : ip;
}

const STAGE_TEXT = {
  ready: "Ready", finding: "Finding best server…", idle: "Measuring idle latency…",
  down: "Testing download…", up: "Testing upload…", calc: "Calculating results…",
  done: "Complete", failed: "Failed", cancelled: "Cancelled", offline: "You appear to be offline",
};
const HKEY = "td-speed-history-v2";

function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
function saveHistory(h) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 20))); } catch { /* private mode */ } }
function detectBrowser() {
  const ua = navigator.userAgent;
  /* order matters: Edge and Opera UAs also contain "Chrome", Chrome's contains "Safari" */
  if (/Edg\//.test(ua)) return "Edge";
  if (/Opera|OPR\//.test(ua)) return "Opera";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}
function detectOS() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  return "Unknown";
}

export default function SpeedTool({ notify }) {
  const servers = useMemo(availableServers, []);
  const [stage, setStage] = useState("ready");
  const [live, setLive] = useState(0);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState(undefined);       // undefined=loading, null=failed
  const [pickedName, setPickedName] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [downSamples, setDownSamples] = useState([]);
  const [upSamples, setUpSamples] = useState([]);
  const [ipObservations, setIpObservations] = useState(loadIpObservations);
  const abortRef = useRef(null);
  const sampleIndexRef = useRef({ down: 0, up: 0 });
  const currentPhaseRef = useRef(null);
  const running = !["ready", "done", "failed", "cancelled", "offline"].includes(stage);

  /* connection panel loads independently of the test (TRAI pattern) */
  useEffect(() => {
    let alive = true;
    fetchMeta(servers[0]).then((m) => {
      if (alive) {
        setMeta(m);
        if (m?.ip) {
          setIpObservations((obs) => {
            const next = recordIpObservation(obs, m.ip);
            if (next !== obs) { try { localStorage.setItem(IP_OBS_KEY, JSON.stringify(next)); } catch { /* private mode */ } }
            return next;
          });
        }
      }
    });
    return () => { alive = false; };
  }, [servers]);

  /* offline awareness */
  useEffect(() => {
    const on = () => setStage((s) => (s === "offline" ? "ready" : s));
    const off = () => { if (!running) setStage("offline"); };
    window.addEventListener("online", on); window.addEventListener("offline", off);
    if (navigator.onLine === false) setStage("offline");
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [running]);

  const start = useCallback(async () => {
    if (running) return;
    setErr(""); setRes(null); setLive(0); setPickedName(null); setDownSamples([]); setUpSamples([]);
    sampleIndexRef.current = { down: 0, up: 0 };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await runFullTest(null, servers, (st, payload) => {
        if (st === "server") setPickedName(payload.name);
        else if (st === "live") {
          setLive(payload);
          if (currentPhaseRef.current === "down") {
            setDownSamples((prev) => [...prev, { t: sampleIndexRef.current.down++, mbps: payload }]);
          } else if (currentPhaseRef.current === "up") {
            setUpSamples((prev) => [...prev, { t: sampleIndexRef.current.up++, mbps: payload }]);
          }
        }
        else if (st !== "idle_sample") {
          if (st === "down" || st === "up") currentPhaseRef.current = st;
          setStage(st);
          setLive(0);
        }
      }, ctrl.signal);
      setRes(r); setStage("done");
      setHistory((h) => { const nh = [r, ...h]; saveHistory(nh); return nh; });
      if (r.tabHidden) notify("Heads-up: the tab was in the background during the test — browsers throttle hidden tabs, so treat this result as a lower bound.");
    } catch (e) {
      if (e?.cancelled || ctrl.signal.aborted) setStage("cancelled");
      else if (e?.offline) setStage("offline");
      else { setErr(e?.message || "The test could not complete."); setStage("failed"); }
    }
  }, [running, servers, notify]);

  const cancel = () => abortRef.current?.abort();
  const prev = history.find((h) => res && h.iso !== res.iso);
  const delta = res && prev ? compareRuns(res, prev) : null;
  const labels = res && res.down != null ? qualityLabels(res.down, res.up ?? 0, res.ping ?? 999) : null;

  const kv = (k, v) => (
    <div className="kv" style={{ padding: "8px 0" }}><span className="k">{k}</span>
      <span className="v" style={{ overflowWrap: "anywhere" }}>{v ?? "Unavailable"}</span></div>
  );

  const progressWidths = { finding: 8, idle: 22, down: 55, up: 85, calc: 97 };
  const progressWidth = progressWidths[stage] ?? 5;

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      {/* ── main test card ── */}
      <div className="panel rise d1">
        <div className="ph"><h3>Network quality test</h3>
          <p>Real transfers against a measurement server — nothing simulated, nothing estimated.</p></div>
        <div className="pb">
          {/* live region announces stage changes to screen readers */}
          <div aria-live="polite" className="st-stage" role="status">
            {STAGE_TEXT[stage]}{pickedName && running ? ` · ${pickedName}` : ""}
          </div>

          {(running || stage === "calc") && (
            <div className="st-livebox" style={{ marginTop: 16, minHeight: 140 }}>
              {/* one gauge instance for both phases: on down → up the needle sweeps back and re-colours instead of remounting */}
              {(stage === "down" || stage === "up") && (
                <>
                  <Speedometer mbps={live} phase={stage} label={stage === "up" ? "Upload" : "Download"} />
                  <div className="st-bar" style={{ marginTop: 12 }}><i style={{ width: `${progressWidth}%` }} /></div>
                </>
              )}
              {stage === "calc" && (
                <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                  <Speedometer mbps={res?.down} phase="down" label="Download" />
                  <Speedometer mbps={res?.up} phase="up" label="Upload" />
                </div>
              )}
              {(stage === "idle" || stage === "finding" || stage === "preparing") && (
                <div className="st-bar"><i style={{ width: `${progressWidth}%` }} /></div>
              )}
            </div>
          )}

          {stage === "ready" && (
            <>
              {/* The test only runs on an explicit click: it can move up to 200 MB, which matters on mobile data. */}
              <button className="btn pri" onClick={start}>Start speed test</button>
              <div className="hint" style={{ marginTop: 10 }}>A speed test may consume up to 200 MB of data.</div>
            </>
          )}
          {running && <button className="btn gh" style={{ width: "100%" }} onClick={cancel}>Cancel test</button>}
          {(stage === "failed" || stage === "cancelled" || stage === "offline") && (
            <>
              {stage === "failed" && <div className="note w" style={{ marginTop: 4 }}><b>Test failed · </b>{err} If an ad blocker or privacy extension is active, it may be blocking the measurement endpoints — try allowing this site or another server.</div>}
              {stage === "offline" && <div className="note w" style={{ marginTop: 4 }}>Your browser reports no network connection. The test will be available again when you're back online.</div>}
              <button className="btn pri" style={{ marginTop: 12 }} onClick={start} disabled={stage === "offline"}>Run a new test</button>
            </>
          )}

          {stage === "done" && res && (
            <>
              {res.partial && <div className="note w"><b>Partial result · </b>one stage didn't transfer enough data to report honestly — its value shows as Unavailable.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, marginTop: 12 }}>
                <Speedometer mbps={res.down} phase="down" label="Download" />
                <Speedometer mbps={res.up} phase="up" label="Upload" />
              </div>
              {downSamples.length > 2 && (
                <LiveGraph series={downSamples} color="var(--teal, #2dd4bf)" label="Download" />
              )}
              {upSamples.length > 2 && (
                <LiveGraph series={upSamples} color="var(--warn, #f59e0b)" label="Upload" />
              )}
              {delta && <div className="hint" style={{ textAlign: "center", marginTop: 2 }}>
                vs last test: ↓ {delta.down > 0 ? "+" : ""}{delta.down ?? "—"} · ↑ {delta.up > 0 ? "+" : ""}{delta.up ?? "—"} · ping {delta.ping > 0 ? "+" : ""}{delta.ping ?? "—"} ms
              </div>}
              <div className="st-mgrid">
                <div className="st-m"><span>Idle latency</span><b>{res.ping ?? "—"} ms</b></div>
                <div className="st-m"><span>Jitter</span><b>{res.jitter ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↓ latency</span><b>{res.loadedDown ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↑ latency</span><b>{res.loadedUp ?? "—"} ms</b></div>
                <div className="st-m"><span>Packet loss</span>
                  {res.loss != null
                    ? <b title={`Downstream estimate from the edge server's TCP counters: ${res.lossDetail?.lost ?? 0} lost + ${res.lossDetail?.retrans ?? 0} retransmitted of ${res.lossDetail?.sent ?? 0} packets sent.`}>{res.loss === 0 ? "0%" : res.loss < 0.01 ? "<0.01%" : `${res.loss}%`}</b>
                    : <b title="This server doesn't expose TCP-level counters via Server-Timing cfL4 headers, so packet loss can't be measured. Only the global edge server reports its TCP retransmission counters.">Unavailable</b>}
                </div>
              </div>
              {res.loadedDown != null && res.ping != null && res.loadedDown > res.ping * 3 && (
                <div className="note i" style={{ marginTop: 10 }}><b>Bufferbloat detected · </b>latency under load is {Math.round(res.loadedDown / res.ping)}× idle — video calls may stutter while downloads run. Router SQM/QoS usually fixes this.</div>
              )}
              {labels && <div style={{ marginTop: 12 }}>
                {labels.map((x) => <div className="qrow" key={x.l}><span className={x.ok ? "ok" : "no"}>{x.ok ? "✓" : "✕"}</span>{x.l}</div>)}
              </div>}
              <div className="kv" style={{ padding: "10px 0 0", borderBottom: 0 }}><span className="k">Server</span><span className="v">{res.server}</span></div>
              <div className="kv" style={{ padding: "6px 0", borderBottom: 0 }}><span className="k">Tested</span><span className="v">{res.when}</span></div>
              <div className="pillrow" style={{ marginTop: 12 }}>
                <button className="pill" onClick={start} style={{ background: "linear-gradient(135deg, var(--pri), var(--teal))", borderColor: "var(--pri-line)", color: "#fff", fontWeight: 600 }}>↻ Retest</button>
              </div>
            </>
          )}

          <div className="hint" style={{ marginTop: 14 }}>
            Results vary with Wi-Fi conditions, VPNs, background downloads and device limits. Methodology differences also
            mean numbers won't exactly match other tools measuring against different servers.
          </div>
        </div>
      </div>

      {/* ── right column: connection + history ── */}
      <div>
        <div className="panel rise d2">
          <div className="ph"><h3>Your connection</h3><p>Looked up from your public IP — location is approximate.</p></div>
          <div className="pb">
            {meta === undefined && <><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18 }} /></>}
            {meta !== undefined && <>
              {kv("Connected via", meta?.ipVersion)}
              {kv("Browser", detectBrowser())}
              {kv("Operating system", detectOS())}
              {kv("Server location", meta?.serverLoc)}
              {kv("Your IP address", meta?.ip ? maskIp(meta.ip) : null)}
              {(() => {
                const ipClass = classifyIp(meta?.ip, ipObservations);
                return kv("IP type", <span title={ipClass.detail}>{ipClass.state}</span>);
              })()}
              {kv("Your location", meta ? [meta.city, meta.region, meta.country].filter(Boolean).join(", ") || null : null)}
              {kv("Your network", meta ? [meta.asn, meta.org].filter(Boolean).join(" · ") || null : null)}
              <div className="hint" style={{ marginTop: 10 }}>
                Your IP address is used only to answer this lookup (approximate location and network name). It isn't stored
                by this page, and results stay on your device unless you copy or export them.
              </div>
            </>}
            {meta === null && <div className="note w" style={{ marginTop: 6 }}>Connection lookup failed — the speed test still works; these fields just stay Unavailable.</div>}
          </div>
        </div>

        {history.length > 0 && (
          <div className="panel rise d3" style={{ marginTop: 16 }}>
            <div className="ph" style={{ display: "flex", alignItems: "center" }}><h3 style={{ flex: 1 }}>History (this device)</h3>
              <button className="pill" onClick={() => { setHistory([]); saveHistory([]); notify("History cleared."); }}>Clear</button></div>
            <div className="pb" style={{ paddingTop: 6 }}>
              {history.slice(0, 6).map((h) => (
                <div className="kv" key={h.iso} style={{ padding: "8px 0" }}>
                  <span className="k" style={{ fontSize: 11.5 }}>{h.when}</span>
                  <span className="v" style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>↓{h.down ?? "—"} ↑{h.up ?? "—"} · {h.ping ?? "—"}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
