import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  availableServers, runFullTest, fetchMeta,
  summaryText, historyCsv, compareRuns, qualityLabels,
} from "../lib/speed.js";

const STAGE_TEXT = {
  ready: "Ready", finding: "Finding best server…", idle: "Measuring idle latency…",
  down: "Testing download…", up: "Testing upload…", calc: "Calculating results…",
  done: "Complete", failed: "Failed", cancelled: "Cancelled", offline: "You appear to be offline",
};
const HKEY = "td-speed-history-v2";

function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
function saveHistory(h) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 20))); } catch { /* private mode */ } }
function dl(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function SpeedTool({ notify }) {
  const servers = useMemo(availableServers, []);
  const [serverId, setServerId] = useState("auto");
  const [stage, setStage] = useState("ready");
  const [live, setLive] = useState(0);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState(undefined);       // undefined=loading, null=failed
  const [pickedName, setPickedName] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const abortRef = useRef(null);
  const running = !["ready", "done", "failed", "cancelled", "offline"].includes(stage);

  /* connection panel loads independently of the test (TRAI pattern) */
  useEffect(() => {
    let alive = true;
    fetchMeta(servers[0]).then((m) => { if (alive) setMeta(m); });
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
    setErr(""); setRes(null); setLive(0); setPickedName(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const chosen = serverId === "auto" ? null : servers.find((s) => s.id === serverId);
    try {
      const r = await runFullTest(chosen, servers, (st, payload) => {
        if (st === "server") setPickedName(payload.name);
        else if (st === "live") setLive(payload);
        else if (st !== "idle_sample") { setStage(st); setLive(0); }
      }, ctrl.signal);
      setRes(r); setStage("done");
      setHistory((h) => { const nh = [r, ...h]; saveHistory(nh); return nh; });
      if (r.tabHidden) notify("Heads-up: the tab was in the background during the test — browsers throttle hidden tabs, so treat this result as a lower bound.");
    } catch (e) {
      if (e?.cancelled || ctrl.signal.aborted) setStage("cancelled");
      else if (e?.offline) setStage("offline");
      else { setErr(e?.message || "The test could not complete."); setStage("failed"); }
    }
  }, [running, serverId, servers, notify]);

  const cancel = () => abortRef.current?.abort();
  const prev = history.find((h) => res && h.iso !== res.iso);
  const delta = res && prev ? compareRuns(res, prev) : null;
  const labels = res && res.down != null ? qualityLabels(res.down, res.up ?? 0, res.ping ?? 999) : null;

  const kv = (k, v) => (
    <div className="kv" style={{ padding: "8px 0" }}><span className="k">{k}</span>
      <span className="v" style={{ overflowWrap: "anywhere" }}>{v ?? "Unavailable"}</span></div>
  );

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

          {running && (
            <div className="st-livebox" aria-hidden="true">
              <div className="st-num">{live > 0 ? live.toFixed(1) : "…"}<small> Mbps</small></div>
              <div className="st-bar"><i style={{ width: `${{ finding: 8, idle: 22, down: 55, up: 85, calc: 97 }[stage] ?? 5}%` }} /></div>
            </div>
          )}

          {stage === "ready" && (
            <>
              <div className="field">
                <label htmlFor="stsrv">Test server</label>
                <select id="stsrv" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                  <option value="auto">Auto — lowest latency</option>
                  {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <button className="btn pri" onClick={start}>Start test</button>
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
              <div className="st-heroes">
                <div className="st-hero"><span className="k">↓ Download</span><b>{res.down ?? "—"}</b><small>Mbps</small></div>
                <div className="st-hero"><span className="k">↑ Upload</span><b>{res.up ?? "—"}</b><small>Mbps</small></div>
              </div>
              {delta && <div className="hint" style={{ textAlign: "center", marginTop: 2 }}>
                vs last test: ↓ {delta.down > 0 ? "+" : ""}{delta.down ?? "—"} · ↑ {delta.up > 0 ? "+" : ""}{delta.up ?? "—"} · ping {delta.ping > 0 ? "+" : ""}{delta.ping ?? "—"} ms
              </div>}
              <div className="st-mgrid">
                <div className="st-m"><span>Idle latency</span><b>{res.ping ?? "—"} ms</b></div>
                <div className="st-m"><span>Jitter</span><b>{res.jitter ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↓ latency</span><b>{res.loadedDown ?? "—"} ms</b></div>
                <div className="st-m"><span>Loaded ↑ latency</span><b>{res.loadedUp ?? "—"} ms</b></div>
                <div className="st-m"><span>Packet loss</span><b title="Browser HTTP transfers retransmit lost packets invisibly, so loss can't be measured honestly here.">Unavailable</b></div>
                <div className="st-m"><span>Data used</span><b>{res.dataUsed} MB</b></div>
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
                <button className="pill" onClick={start}>↻ Retest</button>
                <button className="pill" onClick={() => navigator.clipboard.writeText(summaryText(res)).then(() => notify("Result copied.")).catch(() => notify("Copy blocked."))}>⧉ Copy result</button>
                <button className="pill" onClick={() => dl("speedtest-history.csv", historyCsv(history), "text/csv")}>CSV</button>
                <button className="pill" onClick={() => dl("speedtest-history.json", JSON.stringify(history, null, 2), "application/json")}>JSON</button>
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
              {kv("Server location", meta?.serverLoc)}
              {kv("Your IP address", meta?.ip)}
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
