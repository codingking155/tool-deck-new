import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  availableServers, runFullTest, fetchMeta,
  compareRuns, qualityLabels,
} from "../lib/speed.js";

/* ────────────────────────────────────────────────────────────────────────────
   SPEEDOMETER — SVG needle driven by rAF spring physics (critically damped)
   ──────────────────────────────────────────────────────────────────────────── */

function Speedometer({ mbps, phase, label }) {
  const [angle, setAngle] = useState(0);
  const target = useRef(0), current = useRef(0), vel = useRef(0), raf = useRef(0);

  const gaugeAngle = (mbps) => {
    if (!mbps || mbps <= 0) return 0;
    const log = Math.log10(Math.max(0.1, Math.min(1000, mbps)));
    return (log + 1) * 80;
  };

  target.current = gaugeAngle(mbps ?? 0);

  useEffect(() => {
    const prefersReducedMotion = () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion()) {
      setAngle(target.current);
      return;
    }

    const tick = () => {
      const k = 0.012, damp = 0.86;
      vel.current = (vel.current + (target.current - current.current) * k) * damp;
      current.current += vel.current;
      setAngle(current.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const shown = angle;
  const col = phase === "up" ? "var(--warn, #f59e0b)" : "var(--teal, #2dd4bf)";
  const cx = 130, cy = 130, r = 104;

  const arc = (deg) => {
    const a0 = (150 * Math.PI) / 180;
    const a1 = ((150 + Math.max(0.01, deg)) * Math.PI) / 180;
    const large = deg > 180 ? 1 : 0;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };

  const ticks = [0.1, 1, 5, 10, 25, 50, 100, 250, 500, 1000];

  return (
    <div className="spd-wrap" role="img" aria-label={`${label}: ${mbps == null ? "waiting for samples" : `${mbps.toFixed(1)} megabits per second`}`}>
      <svg viewBox="0 0 260 200" className="spd-svg" style={{ maxWidth: "100%", height: "auto" }}>
        <path d={arc(240)} fill="none" stroke="var(--line2)" strokeWidth="12" strokeLinecap="round" />
        <path d={arc(Math.max(0.5, shown))} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round" />
        {ticks.map((v) => {
          const a = ((150 + gaugeAngle(v)) * Math.PI) / 180;
          return <text key={v} x={cx + (r - 24) * Math.cos(a)} y={cy + (r - 24) * Math.sin(a)}
            textAnchor="middle" dominantBaseline="middle" className="spd-tick" style={{ fontSize: 11, fill: "var(--text2)" }}>
            {v >= 1 ? v : ""}
          </text>;
        })}
        <g transform={`rotate(${150 + shown} ${cx} ${cy})`}>
          <line x1={cx} y1={cy} x2={cx + r - 14} y2={cy} stroke={col} strokeWidth="3" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="7" fill={col} />
        </g>
      </svg>
      <div className="spd-read" aria-hidden="true" style={{ textAlign: "center", marginTop: 8, fontSize: 14 }}>
        <b style={{ color: col, fontSize: 20 }}>{mbps != null && mbps > 0 ? mbps.toFixed(1) : "—"}</b>
        <span style={{ display: "block", fontSize: 12, color: "var(--text2)" }}>Mbps · {label}</span>
      </div>
    </div>
  );
}

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
      <span className="hint" style={{ fontSize: 11, display: "block", marginTop: 4 }}>{label} · peak {maxM.toFixed(1)} Mbps · {series.length} samples</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   IP CLASSIFICATION — Dynamic vs Static Detection
   ──────────────────────────────────────────────────────────────────────────── */

function classifyIp(currentIp, observations = []) {
  if (!currentIp) return {
    state: "Unknown",
    detail: "No public IP was detected in this session."
  };
  const seen = observations.filter((o) => o && o.ip);
  if (seen.length < 2) return {
    state: "Cannot be determined automatically",
    detail: "Static versus dynamic addressing usually cannot be determined reliably from a single browser session.",
  };
  const distinct = new Set(seen.map((o) => o.ip));
  if (distinct.size > 1) return {
    state: "Dynamic (observed)",
    detail: `This device has observed ${distinct.size} different public addresses across ${seen.length} recorded tests — the address changes over time.`,
  };
  const first = new Date(seen[seen.length - 1].iso), last = new Date(seen[0].iso);
  const days = Math.max(0, (last - first) / 86400000);
  if (days >= 7) return {
    state: "Possibly static",
    detail: `The same address has been observed for ${Math.round(days)} days on this device. Long-lease dynamic addresses can look identical — only your ISP can confirm a static assignment.`,
  };
  return {
    state: "Likely dynamic",
    detail: "The address has been stable so far, but the observation window is under a week — most consumer connections use dynamic addressing.",
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
  const [ipObservations, setIpObservations] = useState(() => {
    try { return JSON.parse(localStorage.getItem("td-speed-ip-obs")) || []; } catch { return []; }
  });
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
            const newObs = [{ ip: m.ip, iso: new Date().toISOString() }, ...obs.slice(0, 99)];
            try { localStorage.setItem("td-speed-ip-obs", JSON.stringify(newObs)); } catch {}
            return newObs;
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

          {(running || stage === "done") && (stage === "down" || stage === "up" || stage === "calc") && (
            <div className="st-livebox" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                {stage === "down" && <Speedometer mbps={live || res?.down} phase="down" label="Download" />}
                {stage === "up" && <Speedometer mbps={live || res?.up} phase="up" label="Upload" />}
                {stage === "calc" && (res?.down || res?.up) && (
                  <div style={{ display: "flex", gap: 16 }}>
                    <Speedometer mbps={res.down} phase="down" label="Download" />
                    <Speedometer mbps={res.up} phase="up" label="Upload" />
                  </div>
                )}
                {running && (
                  <div style={{ flex: 1 }}>
                    <div className="st-num">{live > 0 ? live.toFixed(1) : "…"}<small> Mbps</small></div>
                    <div className="st-bar"><i style={{ width: `${progressWidth}%` }} /></div>
                  </div>
                )}
              </div>
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
                    : <b title="This server doesn't expose TCP-level counters via Server-Timing cfL4 headers, so packet loss can't be measured. Only Cloudflare edge servers report their TCP retransmission counters.">Unavailable</b>}
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
              {meta?.ip && (() => {
                const ipClass = classifyIp(meta.ip, ipObservations);
                return kv("IP type", ipClass.state + (ipClass.detail ? ` — ${ipClass.detail}` : ""));
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
