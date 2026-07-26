import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  availableServers, runFullTest, fetchMeta,
  summaryText, historyCsv, compareRuns,
} from "../lib/speed.js";
import {
  healthScore, activityGrades, classifyIp, parseClient, diagnose,
  gaugeAngle, migrateHistory, maskIp, median, HISTORY_VERSION,
} from "../lib/speedCore.mjs";

const STAGE_TEXT = {
  ready: "Ready", preparing: "Preparing test…", finding: "Finding the best measurement server…",
  idle: "Testing idle latency…", down: "Testing download…", up: "Testing upload…",
  calc: "Calculating results…", done: "Complete", failed: "Test failed",
  cancelled: "Test cancelled", offline: "You appear to be offline",
};
const HKEY = "td-speed-history-v3";
const OBSKEY = "td-speed-ip-obs";
const PRIVKEY = "td-speed-ip-priv"; // "masked" (default) | "full" | "none"

function loadJson(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } }
function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
function dl(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const prefersReducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── Animated speedometer — needle driven by real samples via rAF spring ── */
function Speedometer({ mbps, phase, label }) {
  const [angle, setAngle] = useState(0);
  const target = useRef(0), current = useRef(0), vel = useRef(0), raf = useRef(0);
  target.current = gaugeAngle(mbps ?? 0);
  useEffect(() => {
    if (prefersReducedMotion()) { setAngle(target.current); return; }
    const tick = () => {
      /* critically-ish damped spring: natural acceleration, slight overshoot */
      const k = 0.012, damp = 0.86;
      vel.current = (vel.current + (target.current - current.current) * k) * damp;
      current.current += vel.current;
      setAngle(current.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  const shown = prefersReducedMotion() ? target.current : angle;
  const col = phase === "up" ? "var(--warn, #f59e0b)" : "var(--teal, #2dd4bf)";
  const cx = 130, cy = 130, r = 104;
  const arc = (deg) => {
    const a0 = (150 * Math.PI) / 180, a1 = ((150 + Math.max(0.01, deg)) * Math.PI) / 180;
    const large = deg > 180 ? 1 : 0;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  const ticks = [0.1, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
  return (
    <div className="spd-wrap" role="img"
      aria-label={`${label}: ${mbps == null ? "waiting for samples" : `${mbps.toFixed(1)} megabits per second`}`}>
      <svg viewBox="0 0 260 200" className="spd-svg">
        <path d={arc(240)} fill="none" stroke="var(--line2)" strokeWidth="12" strokeLinecap="round" />
        <path d={arc(Math.max(0.5, shown))} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round" />
        {ticks.map((v) => {
          const a = ((150 + gaugeAngle(v)) * Math.PI) / 180;
          return <text key={v} x={cx + (r - 24) * Math.cos(a)} y={cy + (r - 24) * Math.sin(a)}
            textAnchor="middle" dominantBaseline="middle" className="spd-tick">{v >= 1 ? v : ""}</text>;
        })}
        <g transform={`rotate(${150 + shown} ${cx} ${cy})`}>
          <line x1={cx} y1={cy} x2={cx + r - 14} y2={cy} stroke={col} strokeWidth="3" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="7" fill={col} />
        </g>
      </svg>
      <div className="spd-read" aria-hidden="true">
        <b style={{ color: col }}>{mbps != null && mbps > 0 ? mbps.toFixed(1) : "—"}</b>
        <span>Mbps · {label}</span>
      </div>
    </div>
  );
}

/* ── Live throughput graph from real timestamped samples ─────────────── */
function LiveGraph({ series, color, label }) {
  if (!series || series.length < 2) return null;
  const w = 280, h = 56;
  const maxT = series[series.length - 1].t || 1;
  const maxM = Math.max(...series.map((s) => s.mbps), 1);
  const pts = series.map((s) => `${(s.t / maxT * w).toFixed(1)},${(h - 4 - (s.mbps / maxM) * (h - 10)).toFixed(1)}`).join(" ");
  return (
    <div className="spd-graph">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label} throughput over time, peaking at ${maxM.toFixed(1)} megabits per second`}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="hint">{label} · peak {maxM.toFixed(1)} Mbps · {series.length} samples</span>
    </div>
  );
}

const Tip = ({ text, children }) => (
  <span className="spd-tip" tabIndex={0}>
    {children}
    <span role="tooltip" className="spd-tipbox">{text}</span>
  </span>
);

export default function SpeedTool({ notify }) {
  const servers = useMemo(availableServers, []);
  const [serverId, setServerId] = useState("auto");
  const [stage, setStage] = useState("ready");
  const [live, setLive] = useState(0);
  const [liveSeries, setLiveSeries] = useState([]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState(undefined);
  const [pickedName, setPickedName] = useState(null);
  const [history, setHistory] = useState(() => migrateHistory(loadJson(HKEY, loadJson("td-speed-history-v2", []))));
  const [ipPriv, setIpPriv] = useState(() => localStorage.getItem(PRIVKEY) || "masked");
  const [showAdv, setShowAdv] = useState(false);
  const abortRef = useRef(null);
  const running = !["ready", "done", "failed", "cancelled", "offline"].includes(stage);
  const client = useMemo(() => parseClient({
    uaData: navigator.userAgentData ?? null, ua: navigator.userAgent,
    platform: navigator.platform ?? "", touchPoints: navigator.maxTouchPoints ?? 0,
  }), []);

  useEffect(() => { saveJson(HKEY, history.slice(0, 50)); }, [history]);
  useEffect(() => { localStorage.setItem(PRIVKEY, ipPriv); }, [ipPriv]);
  useEffect(() => {
    let alive = true;
    fetchMeta(servers[0]).then((m) => { if (alive) setMeta(m); });
    return () => { alive = false; };
  }, [servers]);
  useEffect(() => {
    const on = () => setStage((s) => (s === "offline" ? "ready" : s));
    const off = () => { if (!running) setStage("offline"); };
    window.addEventListener("online", on); window.addEventListener("offline", off);
    if (navigator.onLine === false) setStage("offline");
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [running]);
  useEffect(() => () => abortRef.current?.abort(), []);   // unmount = clean cancel

  const ipObs = loadJson(OBSKEY, []);
  const ipClass = useMemo(() => classifyIp(meta?.ip, ipObs), [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async () => {
    if (running) return;
    setErr(""); setRes(null); setLive(0); setLiveSeries([]); setPickedName(null); setStage("preparing");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const chosen = serverId === "auto" ? null : servers.find((s) => s.id === serverId);
    try {
      const r = await runFullTest(chosen, servers, (st, payload) => {
        if (st === "server") setPickedName(payload.name);
        else if (st === "live") { setLive(payload); setLiveSeries((xs) => xs.length > 400 ? xs : [...xs, { t: xs.length, mbps: payload }]); }
        else if (st !== "idle_sample") { setStage(st); setLive(0); setLiveSeries([]); }
      }, ctrl.signal);
      setRes(r); setStage("done");
      /* record IP observation for classification (device-local, honest) */
      if (r && meta?.ip) {
        const obs = [{ ip: meta.ip, iso: r.iso }, ...ipObs].slice(0, 30);
        saveJson(OBSKEY, obs);
      }
      const hs = healthScore({ down: r.down, up: r.up, ping: r.ping, jitter: r.jitter, lossPct: r.loss, consistencyScore: r.consistency?.score, bufferbloatWorst: r.bufferbloat?.worst });
      const rec = {
        v: HISTORY_VERSION, id: r.iso, when: r.when, iso: r.iso,
        down: r.down, up: r.up, ping: r.ping, jitter: r.jitter,
        loadedDown: r.loadedDown, loadedUp: r.loadedUp,
        lossPct: r.loss, consistencyScore: r.consistency?.score ?? null,
        bufferbloatGrade: r.bufferbloat?.grade ?? null, health: hs?.score ?? null,
        provider: r.provider, serverId: r.serverId,
        isp: meta?.org ?? null, asn: meta?.asn ?? null,
        ipMasked: ipPriv === "none" ? null : ipPriv === "full" ? meta?.ip ?? null : maskIp(meta?.ip),
        ipClass: ipClass.state, client: `${client.browser} · ${client.os}`,
        mode: "standard", dataUsed: r.dataUsed,
      };
      setHistory((h) => [rec, ...h].slice(0, 50));
      if (r.tabHidden) notify("Heads-up: the tab was backgrounded during the test — browsers throttle hidden tabs, so treat this as a lower bound.");
    } catch (e) {
      if (e?.cancelled || ctrl.signal.aborted) setStage("cancelled");
      else if (e?.offline) setStage("offline");
      else { setErr(e?.message || "Unable to connect to the measurement server."); setStage("failed"); }
    }
  }, [running, serverId, servers, notify, meta, ipObs, ipPriv, ipClass, client]);

  const cancel = () => abortRef.current?.abort();
  const prevRuns = history.filter((h) => !res || h.iso !== res.iso);
  const prevMedianDown = prevRuns.length >= 3 ? median(prevRuns.slice(0, 7).map((h) => h.down).filter((x) => x != null)) : null;
  const delta = res && prevRuns[0] ? compareRuns(res, prevRuns[0]) : null;
  const hs = res ? healthScore({ down: res.down, up: res.up, ping: res.ping, jitter: res.jitter, lossPct: res.loss, consistencyScore: res.consistency?.score, bufferbloatWorst: res.bufferbloat?.worst }) : null;
  const acts = res && res.down != null ? activityGrades({ down: res.down, up: res.up ?? 0, ping: res.ping ?? 999, jitter: res.jitter, lossPct: res.loss, consistencyScore: res.consistency?.score, bufferbloatWorst: res.bufferbloat?.worst }) : null;
  const diag = res ? diagnose({ down: res.down, up: res.up, ping: res.ping, lossPct: res.loss, bufferbloat: res.bufferbloat, consistency: res.consistency }, prevMedianDown) : null;
  const phase = stage === "up" ? "up" : "down";
  const kv = (k, v, tip) => (
    <div className="kv" style={{ padding: "7px 0" }}><span className="k">{k}{tip && <Tip text={tip}> ⓘ</Tip>}</span>
      <span className="v" style={{ overflowWrap: "anywhere" }}>{v ?? "Could not be detected"}</span></div>
  );

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      {/* ── main test card ── */}
      <div className="panel rise d1">
        <div className="ph"><h3>Network quality test</h3>
          <p>Real transfers against a measurement server — nothing simulated, nothing estimated.</p></div>
        <div className="pb">
          <div aria-live="polite" className="st-stage" role="status">
            {STAGE_TEXT[stage]}{pickedName && running ? ` · ${pickedName}` : ""}
          </div>

          {running && ["down", "up"].includes(stage) && (
            <>
              <Speedometer mbps={live} phase={phase} label={phase === "up" ? "Upload" : "Download"} />
              <LiveGraph series={liveSeries.map((s, i) => ({ t: i, mbps: s.mbps }))}
                color={phase === "up" ? "var(--warn, #f59e0b)" : "var(--teal, #2dd4bf)"}
                label={phase === "up" ? "Upload" : "Download"} />
            </>
          )}
          {running && !["down", "up"].includes(stage) && <div className="st-livebox"><div className="st-num">…</div></div>}

          {stage === "ready" && (
            <>
              <button className="btn pri" onClick={start}>Start test</button>
              <div className="hint" style={{ marginTop: 10 }}>
                Takes ~15–25 seconds · uses up to 200 MB of data · the nearest suitable server is selected automatically.
              </div>
              <button className="sh-toggle" onClick={() => setShowAdv((v) => !v)} aria-expanded={showAdv} style={{ marginTop: 12 }}>
                <span>{showAdv ? "▴" : "▾"}</span> Advanced settings
              </button>
              {showAdv && (
                <div className="sh-tech">
                  <div className="field"><label htmlFor="stsrv">Measurement server</label>
                    <select id="stsrv" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                      <option value="auto">Auto — recommended (lowest latency)</option>
                      {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="stpriv">Store my IP in local history as</label>
                    <select id="stpriv" value={ipPriv} onChange={(e) => setIpPriv(e.target.value)}>
                      <option value="masked">Masked (default) — e.g. 103.186.40.x</option>
                      <option value="full">Full address</option>
                      <option value="none">{"Don't store"}</option>
                    </select></div>
                  {serverId !== "auto" && <button className="pill" onClick={() => setServerId("auto")}>Reset to automatic</button>}
                </div>
              )}
            </>
          )}
          {running && <button className="btn gh" style={{ width: "100%", marginTop: 8 }} onClick={cancel}>Cancel test</button>}
          {(stage === "failed" || stage === "cancelled" || stage === "offline") && (
            <>
              {stage === "failed" && <div className="note w" style={{ marginTop: 4 }}><b>Test failed · </b>{err} If an ad blocker or privacy extension is active, it may be blocking the measurement endpoints — try allowing this site or the other server under Advanced settings.</div>}
              {stage === "offline" && <div className="note w" style={{ marginTop: 4 }}>Your browser reports no network connection. The test will be available again when you&apos;re back online.</div>}
              <button className="btn pri" style={{ marginTop: 12 }} onClick={start} disabled={stage === "offline"}>Run a new test</button>
            </>
          )}

          {stage === "done" && res && (
            <>
              {res.partial && <div className="note w"><b>Partial result · </b>one stage {"didn't"} transfer enough data to report honestly — its value shows as unsupported.</div>}
              <div className="st-heroes">
                <div className="st-hero"><span className="k">↓ Download</span><b style={{ color: "var(--teal, #2dd4bf)" }}>{res.down ?? "—"}</b><small>Mbps</small></div>
                <div className="st-hero"><span className="k">↑ Upload</span><b style={{ color: "var(--warn, #f59e0b)" }}>{res.up ?? "—"}</b><small>Mbps</small></div>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <LiveGraph series={res.downSeries} color="var(--teal, #2dd4bf)" label="Download" />
                <LiveGraph series={res.upSeries} color="var(--warn, #f59e0b)" label="Upload" />
              </div>
              {delta && <div className="hint" style={{ textAlign: "center", marginTop: 6 }}>
                vs last test: ↓ {delta.down > 0 ? "+" : ""}{delta.down ?? "—"} · ↑ {delta.up > 0 ? "+" : ""}{delta.up ?? "—"} · ping {delta.ping > 0 ? "+" : ""}{delta.ping ?? "—"} ms
              </div>}
              <div className="st-mgrid">
                <div className="st-m"><span>Idle latency</span><b>{res.ping ?? "—"} ms</b></div>
                <div className="st-m"><span>Jitter</span><b>{res.jitter ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↓</span><b>{res.loadedDown ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↑</span><b>{res.loadedUp ?? "—"} ms</b></div>
                <div className="st-m"><span>Packet loss<Tip text={res.packetLoss?.status === "measured"
                  ? `Downstream estimate from the measurement server's own TCP counters (lost + retransmitted / sent = ${res.packetLoss.detail?.lost ?? 0}+${res.packetLoss.detail?.retrans ?? 0} of ${res.packetLoss.detail?.sent ?? 0}). Browser HTTP can't see raw UDP loss; server-side counters are the honest proxy.`
                  : res.packetLoss?.reason ?? ""}> ⓘ</Tip></span>
                  <b>{res.packetLoss?.status === "measured"
                    ? (res.loss === 0 ? "0%" : res.loss < 0.01 ? "<0.01%" : `${res.loss}%`)
                    : "Not supported by this measurement provider"}</b></div>
                <div className="st-m"><span>Consistency</span><b>{res.consistency?.score != null ? `${res.consistency.score}/100` : "Not enough samples"}</b></div>
              </div>

              {res.bufferbloat && (
                <div className={`note ${"CDF".includes(res.bufferbloat.grade) ? "w" : "i"}`} style={{ marginTop: 10 }}>
                  <b>Bufferbloat: grade {res.bufferbloat.grade} · </b>
                  idle {res.ping} ms → loaded ↓{res.loadedDown ?? "—"} / ↑{res.loadedUp ?? "—"} ms (+{res.bufferbloat.worst} ms worst). {res.bufferbloat.explanation}
                </div>
              )}

              {hs && (
                <div className="spd-score">
                  <div className="spd-scorenum"><b>{hs.score}</b><span>/100 · grade {hs.grade}</span>
                    <Tip text={`Weighted from ${hs.parts.length} measured metrics (coverage ${Math.round(hs.confidence * 100)}%). Speed is capped at 40% of the weight — a fast but unstable line cannot score excellent. Full formula in docs/SPEEDTEST.md.`}> ⓘ</Tip></div>
                  <div className="spd-subs">{hs.parts.map((p) => (
                    <span key={p.key} className="spd-sub"><i style={{ width: `${p.score}%` }} />{p.key} {p.score}</span>
                  ))}</div>
                </div>
              )}

              {acts && <div style={{ marginTop: 12 }}>
                {acts.map((x) => <div className="qrow" key={x.label}>
                  <span className={x.status === "good" ? "ok" : x.status === "fair" ? "mid" : "no"} aria-label={x.status}>{x.status === "good" ? "✓" : x.status === "fair" ? "~" : "✕"}</span>
                  {x.label}<Tip text={`${x.status === "good" ? "Good" : x.status === "fair" ? "Fair" : "Poor"} — ${x.why}.`}> ⓘ</Tip></div>)}
              </div>}

              {diag && <div className="note i" style={{ marginTop: 12 }}>
                <b>Network diagnosis · </b>{diag.lines.join(" ")}
                {diag.recs.length > 0 && <span style={{ display: "block", marginTop: 4 }}>{diag.recs.map((r, i) => <span key={i}>→ {r}<br /></span>)}</span>}
              </div>}

              <div className="kv" style={{ padding: "10px 0 0", borderBottom: 0 }}><span className="k">Measurement provider</span><span className="v">{res.provider} · {res.server}</span></div>
              <div className="kv" style={{ padding: "6px 0", borderBottom: 0 }}><span className="k">Tested</span><span className="v">{res.when} · {res.dataUsed} MB used</span></div>
              <div className="pillrow" style={{ marginTop: 12 }}>
                <button className="pill" onClick={start}>↻ Retest</button>
                <button className="pill" onClick={() => navigator.clipboard.writeText(summaryText(res)).then(() => notify("Result copied.")).catch(() => notify("Copy blocked."))}>⧉ Copy result</button>
                <button className="pill" onClick={() => dl("speedtest-history.csv", historyCsv(history), "text/csv")}>CSV</button>
                <button className="pill" onClick={() => dl("speedtest-history.json", JSON.stringify(history, null, 2), "application/json")}>JSON</button>
              </div>
            </>
          )}

          <div className="hint" style={{ marginTop: 14 }}>
            Results vary with Wi-Fi conditions, VPNs, background downloads and device limits. Your IP is processed only for
            the connection lookup; history stays in this browser with your IP {ipPriv === "none" ? "omitted" : ipPriv} by default.
          </div>
        </div>
      </div>

      {/* ── right column: connection + device + history ── */}
      <div>
        <div className="panel rise d2">
          <div className="ph"><h3>Your connection</h3><p>Looked up from your public IP — location is approximate.</p></div>
          <div className="pb">
            {meta === undefined && <><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18 }} /></>}
            {meta !== undefined && <>
              {kv("Your ISP / network", meta ? [meta.asn, meta.org].filter(Boolean).join(" · ") || null : null, "The operator that sells you internet access — distinct from the measurement provider below.")}
              {kv("Your IP address", meta?.ip)}
              {kv("IP type", `${ipClass.state}`, ipClass.detail)}
              {kv("Connected via", meta?.ipVersion)}
              {kv("Your location", meta ? [meta.city, meta.region, meta.country].filter(Boolean).join(", ") || null : null)}
              {kv("Measurement provider", servers.find((s) => s.id === (res?.serverId ?? "cf"))?.provider ?? "Cloudflare", "The infrastructure that performs the transfers — not your ISP.")}
              {kv("Measurement server", meta?.serverLoc)}
              {kv("Browser", client.version ? `${client.browser} ${client.version}` : client.browser)}
              {kv("Operating system", client.os)}
              {kv("Device", client.device)}
              {"connection" in navigator && navigator.connection?.effectiveType && kv("Effective connection", navigator.connection.effectiveType, "Browser's own coarse estimate (Network Information API) — separate from the measured result.")}
              {kv("Secure context", window.isSecureContext ? "Yes (HTTPS)" : "No")}
              <div className="hint" style={{ marginTop: 10 }}>
                Your IP is sent to the measurement provider&apos;s lookup endpoint to answer these fields; it isn&apos;t stored by
                this page. History stays on this device — clear it anytime below.
              </div>
            </>}
            {meta === null && <div className="note w" style={{ marginTop: 6 }}>Connection information could not be detected — the speed test still works; these fields just stay empty.</div>}
          </div>
        </div>

        {history.length > 0 && (
          <div className="panel rise d3" style={{ marginTop: 16 }}>
            <div className="ph" style={{ display: "flex", alignItems: "center" }}><h3 style={{ flex: 1 }}>History (this device)</h3>
              <button className="pill" onClick={() => { if (confirm("Clear all saved results on this device?")) { setHistory([]); saveJson(OBSKEY, []); notify("History cleared."); } }}>Clear</button></div>
            <div className="pb" style={{ paddingTop: 6 }}>
              {history.slice(0, 8).map((h) => (
                <div className="kv" key={h.id} style={{ padding: "8px 0", gap: 8 }}>
                  <span className="k" style={{ fontSize: 11.5 }}>{h.when}<br /><span style={{ opacity: 0.7 }}>{h.isp ?? "ISP n/a"} · {h.provider ?? "—"}</span></span>
                  <span className="v" style={{ fontFamily: "var(--mono)", fontSize: 12.5, textAlign: "right" }}>
                    ↓{h.down ?? "—"} ↑{h.up ?? "—"} · {h.ping ?? "—"}ms
                    <button className="pill" style={{ marginLeft: 8, padding: "1px 7px" }} aria-label={`Delete result from ${h.when}`}
                      onClick={() => setHistory((xs) => xs.filter((x) => x.id !== h.id))}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
