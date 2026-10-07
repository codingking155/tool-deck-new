import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import {
  ArrowDown, ArrowUp, Activity, Play, Check, X, Info, Minus, RotateCcw,
  Video, Tv, MonitorPlay, Gamepad2, Briefcase, Trash2,
} from "lucide-react";
import {
  availableServers, runFullTest, fetchMeta,
  compareRuns, qualityLabels, summaryText,
} from "../lib/speed.js";
import { Notice, StatusBadge, CopyButton, describeError } from "../components/ui.jsx";
import "./css/speed.css";

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
/* result figures: three significant-ish digits, never more precision than the test has */
const fmtRes = (v) => (v == null ? null : v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const signed = (d) => (d == null ? null : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}`);

/* Decorative: the stage line (a live region) and the result metrics carry the meaning,
   so the gauge stays out of the accessibility tree instead of re-labelling every frame. */
const Speedometer = ({ mbps, phase, label, idle }) => {
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
  const cx = 150, cy = 150, r = 120, tw = 22, rin = r - tw / 2;   // track centre radius / width / inner edge
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
    <div className={`spd-wrap ${up ? "up" : "down"}${idle ? " idle" : ""}`} aria-hidden="true">
      {/* viewBox covers the full arc incl. stroke, every label and the readout */}
      <svg viewBox="0 10 300 240" className="spd-svg" focusable="false">
        <defs>
          <linearGradient id={`${uid}f`} gradientUnits="userSpaceOnUse" x1="40" y1="250" x2="260" y2="20">
            <stop offset="0" className="spd-ga" /><stop offset="1" className="spd-gb" />
          </linearGradient>
          <radialGradient id={`${uid}s`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={rin}>
            <stop offset="0.5" className="spd-gb" stopOpacity="0" />
            <stop offset="1" className="spd-gb" stopOpacity="0.14" />
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
      <div className="spd-read">
        {up ? <ArrowUp size={15} className="spd-ico" strokeWidth={2.2} /> : <ArrowDown size={15} className="spd-ico" strokeWidth={2.2} />}
        <span>Mbps · {label}</span>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   THROUGHPUT SPARKLINE — SVG area + line from the live samples of one phase
   ──────────────────────────────────────────────────────────────────────────── */

function Spark({ series, phase, label, live }) {
  if (!series || series.length < 2) return <div className={`spd-spark ${phase} is-empty`} aria-hidden="true" />;
  const w = 300, h = 64;
  const maxT = series.length - 1 || 1;
  const maxM = Math.max(...series.map((s) => s.mbps), 1);
  const xy = series.map((s, i) => [(i / maxT) * w, h - 3 - (s.mbps / maxM) * (h - 10)]);
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <figure className={`spd-spark ${phase}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" focusable="false"
        {...(live ? { "aria-hidden": "true" } : { role: "img", "aria-label": `${label} throughput over time, peaking at ${maxM.toFixed(1)} megabits per second` })}>
        <polygon className="area" points={`0,${h} ${pts} ${w},${h}`} />
        <polyline className="line" points={pts} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      {!live && <figcaption>{label} over time · peak {maxM.toFixed(1)} Mbps</figcaption>}
    </figure>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   STAGE RAIL — READY → CONNECTING → PING → DOWNLOAD → UPLOAD → COMPLETE
   ──────────────────────────────────────────────────────────────────────────── */

const STEPS = [["ready", "Ready"], ["connect", "Connecting"], ["ping", "Ping"], ["down", "Download"], ["up", "Upload"], ["done", "Complete"]];
const STAGE_STEP = { ready: 0, offline: 0, finding: 1, idle: 2, down: 3, up: 4, calc: 5, done: 5 };

function StageRail({ stage, stoppedAt, running }) {
  const stopped = (stage === "failed" || stage === "cancelled") && stoppedAt != null;
  const at = stopped ? stoppedAt : (STAGE_STEP[stage] ?? 0);
  return (
    <ol className={`spd-rail${running ? " is-running" : ""}`} aria-label="Test stages">
      {STEPS.map(([k, label], i) => {
        const st = stage === "done" || i < at ? "done" : i === at ? (stopped ? "stop" : "now") : "todo";
        return (
          <li key={k} className={st} aria-current={st === "now" ? "step" : undefined}>
            <span className="dot" aria-hidden="true">
              {st === "done" ? <Check size={12} strokeWidth={3} /> : st === "stop" ? <X size={12} strokeWidth={3} /> : null}
            </span>
            <span className="lbl">{label}</span>
            {st === "done" && <span className="sr-only">, done</span>}
            {st === "stop" && <span className="sr-only">, stopped here</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   IP CLASSIFICATION — Dynamic vs Static Detection
   ──────────────────────────────────────────────────────────────────────────── */

/* Observations are stored as a one-way fingerprint of the address (never the IP
   itself), so the page's "isn't stored" promise holds while visits stay comparable.
   v3: SHA-256 over a random per-device salt + the IP. The old unsalted 32-bit FNV
   hash could be reversed by brute force over the IPv4 space; v2 entries are kept as
   `l` (legacy) and upgraded in place the next time the same address is seen. */
const IP_OBS_KEY = "td-speed-ip-obs-v3";
const IP_OBS_V2_KEY = "td-speed-ip-obs-v2";
const IP_OBS_LEGACY_KEY = "td-speed-ip-obs";
const IP_SALT_KEY = "td-speed-ip-salt";

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/* legacy only: recognises v2 entries for the current address */
function fnv1a(ip) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) { h ^= ip.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

let sessionSalt = null;
function deviceSalt() {
  try {
    let s = localStorage.getItem(IP_SALT_KEY);
    if (!/^[0-9a-f]{32}$/.test(s || "")) { s = toHex(crypto.getRandomValues(new Uint8Array(16))); localStorage.setItem(IP_SALT_KEY, s); }
    return s;
  } catch {
    return (sessionSalt ??= toHex(crypto.getRandomValues(new Uint8Array(16))));   // private mode: nothing persists anyway
  }
}

async function ipFingerprint(ip) {
  if (!globalThis.crypto?.subtle) return null;    // insecure context: no history rather than a weak hash
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${deviceSalt()}|${ip}`));
  return toHex(new Uint8Array(d)).slice(0, 32);
}

function loadIpObservations() {
  try {
    const cur = JSON.parse(localStorage.getItem(IP_OBS_KEY));
    if (Array.isArray(cur)) return cur;
    /* one-time migration: v2 FNV fingerprints and the older raw-IP format become legacy entries; raw IPs are dropped */
    const v2 = JSON.parse(localStorage.getItem(IP_OBS_V2_KEY)) || [];
    const raw = JSON.parse(localStorage.getItem(IP_OBS_LEGACY_KEY)) || [];
    const migrated = [
      ...v2.filter((o) => o && o.h && o.iso).map((o) => ({ l: o.h, iso: o.iso })),
      ...raw.filter((o) => o && o.ip && o.iso).map((o) => ({ l: fnv1a(o.ip), iso: o.iso })),
    ].sort((a, b) => (a.iso < b.iso ? 1 : -1)).slice(0, 100);
    localStorage.setItem(IP_OBS_KEY, JSON.stringify(migrated));
    localStorage.removeItem(IP_OBS_V2_KEY);
    localStorage.removeItem(IP_OBS_LEGACY_KEY);
    return migrated;
  } catch { return []; }
}

/* one entry per address per hour — reloads and StrictMode double-mounts shouldn't count as evidence */
function recordIpObservation(obs, h, legacyH) {
  const now = Date.now();
  const upgraded = obs.map((o) => (o?.l && o.l === legacyH ? { h, iso: o.iso } : o));
  const changed = upgraded.some((o, i) => o !== obs[i]);
  if (upgraded[0] && upgraded[0].h === h && now - new Date(upgraded[0].iso).getTime() < 3600000) return changed ? upgraded : obs;
  return [{ h, iso: new Date(now).toISOString() }, ...upgraded].slice(0, 100);
}

/** Static vs dynamic from this device's own history — a browser can't ask the ISP,
    so it only ever reports what the evidence supports. Always returns a valid state. */
function classifyIp(currentHash, observations = []) {
  if (!currentHash) return { state: "Unknown", detail: "No public IP was detected in this session." };
  const seen = observations.filter((o) => o && (o.h || o.l) && o.iso);
  const distinct = new Set([currentHash, ...seen.map((o) => o.h || `legacy:${o.l}`)]);
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
  ready: "Ready to test", finding: "Connecting to the nearest server…", idle: "Measuring ping…",
  down: "Testing download…", up: "Testing upload…", calc: "Calculating results…",
  done: "Complete", failed: "Test stopped", cancelled: "Test cancelled", offline: "Offline",
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

/* ────────────────────────────────────────────────────────────────────────────
   RESULT PIECES
   ──────────────────────────────────────────────────────────────────────────── */

/** Headline result. `null` renders a neutral "Unavailable" with the reason in words. */
function HeadMetric({ icon: Icon, kind, label, value, unit, delta, why, children }) {
  const na = value == null;
  return (
    <div className={`spd-head ${kind}${na ? " na" : ""}`}>
      <div className="lab"><Icon size={14} aria-hidden="true" strokeWidth={2.4} />{label}</div>
      {na
        ? <div className="val na">Unavailable</div>
        : <div className="val">{value}<small>{unit}</small></div>}
      {na ? <p className="why"><Info size={12} aria-hidden="true" />{why}</p>
        : delta != null && <p className="delta">{delta} {unit} vs last test</p>}
      {children}
    </div>
  );
}

function SecMetric({ label, value, unit, why, title }) {
  const na = value == null;
  return (
    <div className={`spd-sec${na ? " na" : ""}`} title={title}>
      <div className="k">{label}</div>
      <div className="v">{na ? "Unavailable" : <>{value}{unit && <small>{unit}</small>}</>}</div>
      {na && why && <div className="why">{why}</div>}
    </div>
  );
}

const QUALITY_ICON = { "WhatsApp video calls": Video, "HD streaming": Tv, "4K streaming": MonitorPlay, "Online gaming": Gamepad2, "Work from home": Briefcase };

function QualityList({ labels }) {
  return (
    <ul className="spd-qual">
      {labels.map((x) => {
        const Icon = QUALITY_ICON[x.l] || Activity;
        return (
          <li key={x.l} className={x.ok ? "ok" : "no"}>
            <Icon size={16} aria-hidden="true" strokeWidth={2} className="qi" />
            <span className="ql">{x.l}</span>
            {x.ok
              ? <StatusBadge tone="ok" icon={Check}>Good</StatusBadge>
              : <StatusBadge icon={Minus}>Limited</StatusBadge>}
          </li>
        );
      })}
    </ul>
  );
}

function lossValue(res) {
  if (res.loss == null) return null;
  return res.loss === 0 ? "0" : res.loss < 0.01 ? "<0.01" : String(res.loss);
}

function Results({ res, delta, downSamples, upSamples }) {
  const labels = res.down != null ? qualityLabels(res.down, res.up ?? 0, res.ping ?? 999) : null;
  const bloat = res.loadedDown != null && res.ping != null && res.loadedDown > res.ping * 3;
  return (
    <div className="spd-results">
      {res.partial && (
        <Notice tone="w" title="Partial result">
          One stage didn't transfer enough data to report honestly — its value shows as Unavailable rather than a guess.
        </Notice>
      )}
      <div className="spd-heads">
        <HeadMetric icon={ArrowDown} kind="down" label="Download" value={fmtRes(res.down)} unit="Mbps"
          delta={delta && signed(delta.down)} why="Not enough data arrived to measure download honestly.">
          {downSamples.length > 2 && <Spark series={downSamples} phase="down" label="Download" />}
        </HeadMetric>
        <HeadMetric icon={ArrowUp} kind="up" label="Upload" value={fmtRes(res.up)} unit="Mbps"
          delta={delta && signed(delta.up)} why="Not enough data was sent to measure upload honestly.">
          {upSamples.length > 2 && <Spark series={upSamples} phase="up" label="Upload" />}
        </HeadMetric>
        <HeadMetric icon={Activity} kind="lat" label="Latency" value={res.ping == null ? null : String(res.ping)} unit="ms"
          delta={delta && signed(delta.ping)} why="Every latency probe failed.">
          <p className="spd-headnote">Idle round-trip time (ping)</p>
        </HeadMetric>
      </div>

      <h3 className="spd-h3">Details</h3>
      <div className="spd-secs">
        <SecMetric label="Jitter" value={res.jitter} unit="ms" why="Too few latency probes succeeded." />
        <SecMetric label="Loaded latency · download" value={res.loadedDown} unit="ms" why="No probe finished while downloading." />
        <SecMetric label="Loaded latency · upload" value={res.loadedUp} unit="ms" why="No probe finished while uploading." />
        <SecMetric label="Packet loss" value={lossValue(res)} unit="%"
          why="This server doesn't expose TCP counters, so loss can't be measured."
          title={res.loss != null
            ? `Downstream estimate from the edge server's TCP counters: ${res.lossDetail?.lost ?? 0} lost + ${res.lossDetail?.retrans ?? 0} retransmitted of ${res.lossDetail?.sent ?? 0} packets sent.`
            : "This server doesn't expose TCP-level counters via Server-Timing cfL4 headers, so packet loss can't be measured. Only the global edge server reports its TCP retransmission counters."} />
        <SecMetric label="Data used" value={res.dataUsed} unit="MB" />
      </div>

      {bloat && (
        <Notice tone="i" title="Bufferbloat detected">
          Latency under load is {Math.round(res.loadedDown / res.ping)}× idle — video calls may stutter while downloads run.
          Router SQM/QoS usually fixes this.
        </Notice>
      )}

      {labels && <>
        <h3 className="spd-h3">What this connection handles</h3>
        <QualityList labels={labels} />
      </>}

      <div className="spd-meta">
        <div className="kv"><span className="k">Server</span><span className="v">{res.server}</span></div>
        <div className="kv"><span className="k">Tested</span><span className="v">{res.when}</span></div>
      </div>
    </div>
  );
}

const ConnRow = ({ k, children }) => (
  <div className="kv"><span className="k">{k}</span><span className="v">{children ?? <span className="spd-na">Unavailable</span>}</span></div>
);

const CONN_ROWS = 8;

function ConnectionPanel({ meta, ipHash, ipObservations }) {
  const ipClass = meta ? classifyIp(meta.ip ? ipHash : null, ipObservations) : null;
  return (
    <section className="panel spd-conn" aria-labelledby="spd-conn-h">
      <div className="ph"><h2 id="spd-conn-h">Your connection</h2><p>Looked up from your public IP — location is approximate.</p></div>
      <div className="pb" aria-busy={meta === undefined}>
        {meta === undefined && Array.from({ length: CONN_ROWS }, (_, i) => (
          <div className="kv spd-skrow" key={i}><span className="skel" /><span className="skel" /></div>
        ))}
        {meta !== undefined && <>
          {meta === null && (
            <Notice tone="off" title="Connection lookup failed">
              The speed test still works — these fields just stay Unavailable.
            </Notice>
          )}
          <ConnRow k="Connected via">{meta?.ipVersion}</ConnRow>
          <ConnRow k="Browser">{detectBrowser()}</ConnRow>
          <ConnRow k="Operating system">{detectOS()}</ConnRow>
          <ConnRow k="Server location">{meta?.serverLoc}</ConnRow>
          <ConnRow k="Your IP address">{meta?.ip ? maskIp(meta.ip) : null}</ConnRow>
          <ConnRow k="IP type"><span title={ipClass?.detail}>{ipClass?.state ?? "Unknown"}</span></ConnRow>
          <ConnRow k="Your location">{meta ? [meta.city, meta.region, meta.country].filter(Boolean).join(", ") || null : null}</ConnRow>
          <ConnRow k="Your network">{meta ? [meta.asn, meta.org].filter(Boolean).join(" · ") || null : null}</ConnRow>
          {ipClass && <p className="hint">IP type: {ipClass.detail}</p>}
          <p className="hint">
            Your IP address is used only to answer this lookup (approximate location and network name). It isn't stored
            by this page, and results stay on your device unless you copy or export them.
          </p>
        </>}
      </div>
    </section>
  );
}

function HistoryPanel({ history, onClear }) {
  return (
    <section className="panel spd-hist" aria-labelledby="spd-hist-h">
      <div className="ph spd-hist-ph">
        <h2 id="spd-hist-h">History <span>(this device)</span></h2>
        <button type="button" className="btn qt sm" onClick={onClear}><Trash2 size={14} aria-hidden="true" />Clear</button>
      </div>
      <div className="pb">
        <ul className="spd-hist-list">
          {history.slice(0, 6).map((h) => (
            <li key={h.iso}>
              <span className="when">{h.when}</span>
              <span className="nums">
                <span><ArrowDown size={12} aria-hidden="true" /><span className="sr-only">Download </span>{h.down ?? "—"}</span>
                <span><ArrowUp size={12} aria-hidden="true" /><span className="sr-only">Upload </span>{h.up ?? "—"}</span>
                <span><span className="sr-only">Latency </span>{h.ping ?? "—"} ms</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   TOOL
   ──────────────────────────────────────────────────────────────────────────── */

export default function SpeedTool({ notify }) {
  const servers = useMemo(availableServers, []);
  const [stage, setStage] = useState("ready");
  const [live, setLive] = useState(0);
  const [livePing, setLivePing] = useState(null);     // { ms, n } provisional, from idle probes so far
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [stoppedAt, setStoppedAt] = useState(null);
  const [meta, setMeta] = useState(undefined);       // undefined=loading, null=failed
  const [pickedName, setPickedName] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [downSamples, setDownSamples] = useState([]);
  const [upSamples, setUpSamples] = useState([]);
  const [ipObservations, setIpObservations] = useState(loadIpObservations);
  const [ipHash, setIpHash] = useState(null);
  const abortRef = useRef(null);
  const sampleIndexRef = useRef({ down: 0, up: 0 });
  const currentPhaseRef = useRef(null);
  const stepRef = useRef(0);
  const running = !["ready", "done", "failed", "cancelled", "offline"].includes(stage);

  /* leaving the tool mid-test must stop the transfers, not let them run on unseen */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* connection panel loads independently of the test (TRAI pattern) */
  useEffect(() => {
    let alive = true;
    fetchMeta(servers[0]).then(async (m) => {
      if (!alive) return;
      setMeta(m);
      if (!m?.ip) return;
      const h = await ipFingerprint(m.ip).catch(() => null);
      if (!alive || !h) return;
      setIpHash(h);
      setIpObservations((obs) => {
        const next = recordIpObservation(obs, h, fnv1a(m.ip));
        if (next !== obs) { try { localStorage.setItem(IP_OBS_KEY, JSON.stringify(next)); } catch { /* private mode */ } }
        return next;
      });
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
    setErr(""); setRes(null); setLive(0); setLivePing(null); setPickedName(null); setDownSamples([]); setUpSamples([]);
    setStoppedAt(null);
    sampleIndexRef.current = { down: 0, up: 0 };
    stepRef.current = 0;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cb = (st, payload) => {
      if (st === "server") setPickedName(payload.name);
      else if (st === "live") {
        setLive(payload);
        if (currentPhaseRef.current === "down") {
          setDownSamples((prev) => [...prev, { t: sampleIndexRef.current.down++, mbps: payload }]);
        } else if (currentPhaseRef.current === "up") {
          setUpSamples((prev) => [...prev, { t: sampleIndexRef.current.up++, mbps: payload }]);
        }
      }
      else if (st === "idle_sample") {
        /* provisional readout only — the reported ping comes from the library's cleaned median */
        const ok = payload.filter((x) => x != null).sort((a, b) => a - b);
        setLivePing({ ms: ok.length ? Math.round(ok[Math.floor(ok.length / 2)]) : null, n: payload.length });
      }
      else {
        if (st === "down" || st === "up") currentPhaseRef.current = st;
        if (STAGE_STEP[st] != null) stepRef.current = STAGE_STEP[st];
        setStage(st);
        setLive(0);
      }
    };
    try {
      const r = await runFullTest(null, servers, cb, ctrl.signal);
      setRes(r); setStage("done");
      setHistory((h) => { const nh = [r, ...h]; saveHistory(nh); return nh; });
      if (r.tabHidden) notify("Heads-up: the tab was in the background during the test — browsers throttle hidden tabs, so treat this result as a lower bound.");
    } catch (e) {
      setStoppedAt(stepRef.current);
      if (e?.cancelled || ctrl.signal.aborted) setStage("cancelled");
      else if (e?.offline) setStage("offline");
      else { setErr(e?.message || "The test could not complete."); setStage("failed"); }
    }
  }, [running, servers, notify]);

  const cancel = () => abortRef.current?.abort();
  const clearHistory = () => { setHistory([]); saveHistory([]); notify("History cleared."); };
  const prev = history.find((h) => res && h.iso !== res.iso);
  const delta = res && prev ? compareRuns(res, prev) : null;
  const failure = stage === "failed" ? describeError(new Error(err), { service: "the test servers" }) : null;

  const phase = stage === "up" ? "up" : "down";
  const gaugeLabel = stage === "down" ? "Download" : stage === "up" ? "Upload" : stage === "calc" ? "Finishing" : "Waiting";
  const announce = stage === "done" && res
    ? ` — download ${fmtRes(res.down) ?? "unavailable"}${res.down != null ? " megabits per second" : ""}, upload ${fmtRes(res.up) ?? "unavailable"}${res.up != null ? " megabits per second" : ""}, latency ${res.ping ?? "unavailable"}${res.ping != null ? " milliseconds" : ""}.`
    : "";

  return (
    <div className="spd-layout">
      <section className="panel spd-main" aria-label="Speed test">
        <div className="pb">
          <StageRail stage={stage} stoppedAt={stoppedAt} running={running} />

          <div className="spd-statusrow">
            <p className="spd-status" role="status" aria-live="polite" aria-atomic="true">
              {STAGE_TEXT[stage]}
              <span className="sr-only">{announce}</span>
            </p>
            {pickedName && running && <span className="spd-server">Server · {pickedName}</span>}
          </div>

          {(stage === "ready" || stage === "offline") && (
            <div className="spd-ready">
              <Speedometer mbps={null} phase="down" label="Ready" idle />
              {stage === "offline" && (
                <Notice tone="off" title="You're offline">
                  Your browser reports no network connection. The test will be available again when you're back online.
                </Notice>
              )}
              <div className="spd-cta">
                {/* The test only runs on an explicit click: it moves real data, which matters on mobile plans. */}
                <button type="button" className="btn pri auto spd-go" onClick={() => start()} disabled={stage === "offline"}>
                  <Play size={17} aria-hidden="true" strokeWidth={2.4} />Run speed test
                </button>
              </div>
              <p className="spd-data">
                <Info size={13} aria-hidden="true" />
                <span>Uses about 20–35 MB on a typical connection (never more than 200 MB on very fast links).</span>
              </p>
            </div>
          )}

          {running && (
            <div className="spd-live">
              <Speedometer mbps={stage === "down" || stage === "up" ? live : 0} phase={phase} label={gaugeLabel} />
              <div className="spd-under">
                {(stage === "down" || stage === "up") && (
                  <Spark series={stage === "down" ? downSamples : upSamples} phase={phase} label={gaugeLabel} live />
                )}
                {stage === "finding" && <p className="spd-sub">Picking the closest, fastest server…</p>}
                {stage === "idle" && (
                  <p className="spd-sub">
                    Latency <b>{livePing?.ms != null ? `≈ ${livePing.ms} ms` : "—"}</b>
                    <span>probe {livePing?.n ?? 0} of 10</span>
                  </p>
                )}
                {stage === "calc" && <p className="spd-sub">Crunching the numbers…</p>}
              </div>
              <button type="button" className="btn gh auto spd-cancel" onClick={cancel}><X size={15} aria-hidden="true" />Cancel test</button>
            </div>
          )}

          {(stage === "failed" || stage === "cancelled") && (
            <div className="spd-stop">
              {stage === "failed" && (
                <Notice tone="w" title={failure.title}>
                  {failure.hint} If an ad blocker or privacy extension is active, it may be blocking the measurement endpoints — try allowing this site.
                  {err && <details><summary>Technical detail</summary><code>{err}</code></details>}
                </Notice>
              )}
              {stage === "cancelled" && (
                <Notice tone="i" title="Test cancelled">Nothing was saved. Run it again whenever you're ready.</Notice>
              )}
              <div className="actions">
                <button type="button" className="btn pri auto" onClick={() => start()}>
                  <RotateCcw size={16} aria-hidden="true" />Run again
                </button>
              </div>
            </div>
          )}

          {stage === "done" && res && <>
            <Results res={res} delta={delta} downSamples={downSamples} upSamples={upSamples} />
            <div className="actions spd-actions">
              <button type="button" className="btn pri auto" onClick={() => start()}>
                <RotateCcw size={16} aria-hidden="true" />Run again
              </button>
              <CopyButton text={() => summaryText(res)} label="Copy result" className="btn" notify={notify} toast="Result copied." />
            </div>
          </>}

          <p className="hint spd-foot">
            Real transfers against a measurement server — nothing estimated. Results vary with Wi-Fi conditions, VPNs, background
            downloads and device limits, and won't exactly match tools that measure against different servers.
          </p>
        </div>
      </section>

      <div className="spd-aside">
        <ConnectionPanel meta={meta} ipHash={ipHash} ipObservations={ipObservations} />
        {history.length > 0 && <HistoryPanel history={history} onClear={clearHistory} />}
      </div>
    </div>
  );
}
