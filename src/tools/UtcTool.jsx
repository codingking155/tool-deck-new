import { useState, useEffect, useMemo } from "react";
import {
  pad, DAYS, DAYS_FULL, USER_TZ,
  zonedToUtc, localDateOf, dowOf,
  fmtUtc, fmtUtcDate, fmtLocal, fmtDur,
  buildWaitSchedule, getNextValidSendUtc, getDateTimeWarning,
} from "../lib/time.js";
import ZonePicker from "../components/ZonePicker.jsx";
import { Switch, ShareLink } from "../components/chrome.jsx";
import { useNow, readParams, writeParams } from "../hooks/index.js";

export default function UtcTool({ notify }) {
  const now = useNow(1000);
  const P = readParams();
  const [mode, setMode] = useState(() => (P.get("m") === "order" ? "order" : "schedule"));
  const nowUtcDate = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  /* schedule mode state (shareable via the URL) */
  const [startDate, setStartDate] = useState(() => P.get("sd") || nowUtcDate);
  const [startTime, setStartTime] = useState(() => P.get("st") || `${pad(now.getUTCHours())}:00`);
  const [amount, setAmount] = useState(() => P.get("a") || 24);
  const [unit, setUnit] = useState(() => (["minutes", "hours", "days"].includes(P.get("u")) ? P.get("u") : "hours"));
  const [reps, setReps] = useState(() => P.get("r") || 10);
  const [tz1, setTz1] = useState(() => P.get("tz") || USER_TZ);
  const [tz2, setTz2] = useState(() => P.get("tz2") || "");
  useEffect(() => {
    writeParams({ m: mode === "order" ? "order" : null, sd: startDate, st: startTime, a: amount, u: unit, r: reps, tz: tz1, tz2: tz2 || null });
  }, [mode, startDate, startTime, amount, unit, reps, tz1, tz2]);

  const rows = useMemo(
    () => buildWaitSchedule({ startDate, startTime, amount: +amount, unit, repetitions: +reps, tz1, tz2: tz2 || null }),
    [startDate, startTime, amount, unit, reps, tz1, tz2]
  );
  const nowMs = now.getTime();
  const firstFuture = rows.findIndex((r) => r.t.getTime() >= nowMs);
  const todayLocal = localDateOf(now, tz1);

  /* order mode state — resolution runs through the audited weekend-aware core */
  const [oTz, setOTz] = useState(USER_TZ);
  const [oDate, setODate] = useState(localDateOf(now, USER_TZ));
  const [oTime, setOTime] = useState("18:00");
  const [sTime, setSTime] = useState("08:00");
  const [skipWk, setSkipWk] = useState(true);
  const orderRes = useMemo(() => {
    if (mode !== "order" || !oDate || !oTime || !sTime) return null;
    try {
      const orderUtc = zonedToUtc(oDate, oTime, oTz);
      const { sendUtc, skippedDays } = getNextValidSendUtc(orderUtc, sTime, oTz, { skipWeekends: skipWk });
      const warning = getDateTimeWarning(oDate, oTime, oTz, "The order time");
      return { orderUtc, sendUtc, skipped: skippedDays, waitMs: sendUtc - orderUtc, warning };
    } catch { return { error: true }; }
  }, [mode, oDate, oTime, sTime, oTz, skipWk]);

  const copyRow = (r) => {
    const line = [`#${r.idx}`, `${r.utcTime} UTC ${r.utcDate}`, `${r.localTime} ${r.localDate} (${tz1})`, r.cmpTime ? `${r.cmpTime} ${r.cmpDate} (${tz2})` : "", DAYS_FULL[r.dow]].filter(Boolean).join(" · ");
    navigator.clipboard.writeText(line).then(() => notify("Row copied.")).catch(() => notify("Copy blocked."));
  };
  const tableTsv = () => {
    const head = ["#","UTC time","UTC date","Local time","Local date", ...(tz2 ? ["Compare time","Compare date"] : []),"Day","Status","ISO"];
    const lines = rows.map((r) => {
      const st = r.t.getTime() < nowMs ? "Completed" : rows.indexOf(r) === firstFuture ? "Active (next)" : "Upcoming";
      return [r.idx, r.utcTime, r.utcDate, r.localTime, r.localDate, ...(tz2 ? [r.cmpTime, r.cmpDate] : []), DAYS_FULL[r.dow], st, r.iso].join("\t");
    });
    return [head.join("\t"), ...lines].join("\n");
  };
  const copyTable = () => navigator.clipboard.writeText(tableTsv()).then(() => notify("Full table copied.")).catch(() => notify("Copy blocked."));
  const downloadCsv = () => {
    const csv = tableTsv().split("\n").map((l) => l.split("\t").map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "utc-wait-schedule.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    notify("CSV downloaded.");
  };

  return (
    <div>
      <div className="modes" role="tablist">
        <button role="tab" aria-selected={mode === "schedule"} className={mode === "schedule" ? "on" : ""} onClick={() => setMode("schedule")}>Day-wise wait schedule</button>
        <button role="tab" aria-selected={mode === "order"} className={mode === "order" ? "on" : ""} onClick={() => setMode("order")}>Order → notification (skips weekends)</button>
      </div>

      {mode === "schedule" && (
        <>
          <div className="grid2">
            <div className="panel rise d1">
              <div className="ph"><h3>Schedule parameters</h3><p>All rows are generated from the UTC reference time.</p></div>
              <div className="pb">
                <div className="two">
                  <div className="field"><label htmlFor="usd">UTC start date</label><input id="usd" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                  <div className="field"><label htmlFor="ust">UTC start time</label><input id="ust" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                </div>
                <div className="three">
                  <div className="field"><label htmlFor="amt">Wait every</label><input id="amt" type="number" min="1" max="9999" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <div className="field"><label htmlFor="unit">Unit</label>
                    <select id="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                      <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
                    </select></div>
                  <div className="field"><label htmlFor="reps">Repetitions</label><input id="reps" type="number" min="1" max="120" value={reps} onChange={(e) => setReps(e.target.value)} /></div>
                </div>
                <div className="field"><label>Your timezone (auto-detected)</label><ZonePicker value={tz1} onChange={setTz1} /></div>
                <div className="field"><label>Compare timezone (optional)</label><ZonePicker value={tz2} onChange={setTz2} allowNone /></div>
                <div className="hint">Weekend rows are tinted amber. Today's row is highlighted. Times update live.</div>
              </div>
            </div>

            <div className="panel rise d2">
              {rows.length === 0 ? <div className="empty">Set a start time, duration and repetitions to generate the schedule.</div> : (
                <>
                  <div className="bigres">
                    <div className="lab">Next occurrence {firstFuture >= 0 ? `(#${rows[firstFuture].idx})` : ""}</div>
                    {firstFuture >= 0 ? (
                      <>
                        <div className="val">{fmtDur(rows[firstFuture].t.getTime() - nowMs)}</div>
                        <div className="sub">{rows[firstFuture].utcTime} UTC · {rows[firstFuture].utcDate} — that's {rows[firstFuture].localTime} your time ({DAYS_FULL[rows[firstFuture].dow]}).</div>
                      </>
                    ) : (<><div className="val">All done</div><div className="sub">Every occurrence in this schedule has already passed.</div></>)}
                  </div>
                  <div className="kv"><span className="k">UTC reference start</span><span className="v hl">{startTime} UTC · {startDate}</span></div>
                  <div className="kv"><span className="k">Interval</span><span className="v">{amount} {unit} × {rows.length} repetitions</span></div>
                  <div className="kv"><span className="k">Span</span><span className="v">{fmtDur(rows[rows.length - 1].t - rows[0].t)}</span></div>
                  <div className="kv"><span className="k">Weekend occurrences</span><span className="v">{rows.filter((r) => r.isWeekend).length} of {rows.length}</span></div>
                </>
              )}
            </div>
          </div>

          <div className="secbar rise d3">
            <h3>Day-wise wait table</h3>
            <div className="r">
              <ShareLink notify={notify} />
              <button className="btn gh" onClick={copyTable} disabled={!rows.length}>⧉ Copy table</button>
              <button className="btn gh" onClick={downloadCsv} disabled={!rows.length}>⬇ CSV</button>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="tblwrap rise d3">
              <table className="rt">
                <thead><tr><th>#</th><th>UTC</th><th>Your local</th>{tz2 && <th>Compare</th>}<th>Day</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const done = r.t.getTime() < nowMs;
                    const active = i === firstFuture;
                    return (
                      <tr key={r.idx} className={`${r.isWeekend ? "wkend" : ""} ${r.localDayStr === todayLocal ? "today" : ""}`} style={{ animationDelay: `${Math.min(i * 0.02, 0.4)}s` }}>
                        <td className="sm">{r.idx}</td>
                        <td><span className="c-utc">{r.utcTime}</span><div className="sm">{r.utcDate}</div></td>
                        <td><span className="c-loc">{r.localTime}</span><div className="sm">{r.localDate}</div></td>
                        {tz2 && <td>{r.cmpTime}<div className="sm">{r.cmpDate}</div></td>}
                        <td>{DAYS[r.dow]}{r.isWeekend && <span className="chip wk" style={{ marginLeft: 6 }}>WKND</span>}</td>
                        <td>{done ? "—" : fmtDur(r.t.getTime() - nowMs)}</td>
                        <td>{done ? <span className="chip done">COMPLETED</span> : active ? <span className="chip act">ACTIVE · NEXT</span> : <span className="chip up">UPCOMING</span>}</td>
                        <td><button className="rowcopy" title="Copy row" aria-label={`Copy row ${r.idx}`} onClick={() => copyRow(r)}>⧉</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mode === "order" && (
        <div className="grid2">
          <div className="panel rise d1">
            <div className="ph"><h3>Order parameters</h3><p>Local order time converts to UTC; Sat & Sun sends move to Monday.</p></div>
            <div className="pb">
              <div className="field"><label>Customer timezone</label><ZonePicker value={oTz} onChange={setOTz} /></div>
              <div className="field"><label htmlFor="od">Order date</label><input id="od" type="date" value={oDate} onChange={(e) => setODate(e.target.value)} /></div>
              <div className="two">
                <div className="field"><label htmlFor="ot">Order created</label><input id="ot" type="time" value={oTime} onChange={(e) => setOTime(e.target.value)} /></div>
                <div className="field"><label htmlFor="st">Send at (local)</label><input id="st" type="time" value={sTime} onChange={(e) => setSTime(e.target.value)} /></div>
              </div>
              <div className="tgl"><div><div className="t">Skip weekends</div><div className="s">Friday-evening orders notify Monday morning</div></div>
                <Switch on={skipWk} onChange={setSkipWk} label="Skip weekends" /></div>
              {orderRes && orderRes.warning && <div className="note w"><b>Heads up · </b>{orderRes.warning}</div>}
            </div>
          </div>
          <div className="panel rise d2">
            {!orderRes || orderRes.error ? <div className="empty">Fill all fields to compute the wait.</div> : (
              <>
                <div className="bigres">
                  <div className="lab">Wait until notification</div>
                  <div className="val">{fmtDur(orderRes.waitMs)}</div>
                  <div className="sub">{Math.round(orderRes.waitMs / 60000).toLocaleString()} minutes total{orderRes.skipped.length ? ` · ${orderRes.skipped.length} weekend day(s) skipped (${orderRes.skipped.map((s) => DAYS[s.dow]).join(" + ")})` : ""}.</div>
                </div>
                <div className="kv"><span className="k">Order created</span><span className="v">{fmtLocal(orderRes.orderUtc, oTz)} local · {fmtUtc(orderRes.orderUtc)} UTC · {fmtUtcDate(orderRes.orderUtc)}</span></div>
                <div className="kv"><span className="k">Notification sends</span><span className="v hl">{fmtUtc(orderRes.sendUtc)} UTC · {fmtUtcDate(orderRes.sendUtc)} ({fmtLocal(orderRes.sendUtc, oTz)} local, {DAYS_FULL[dowOf(orderRes.sendUtc, "local", oTz)]})</span></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
