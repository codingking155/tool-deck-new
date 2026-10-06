import { useState, useEffect, useMemo } from "react";
import {
  pad, USER_TZ, isValidZone, zonedToUtc, fmtDur,
  fmtUtc, fmtUtcDate, fmtLocal, fmt12Str, fmtDurDays, nextSendUtc, skippedWeekendDays, buildOrderRows, getDateTimeWarning,
} from "../lib/time.js";
import ZonePicker from "../components/ZonePicker.jsx";
import { Switch, ShareLink } from "../components/chrome.jsx";
import { readParams, writeParams, useNow } from "../hooks/index.js";
import { buildIcs, googleCalendarUrl } from "../lib/ics.js";

const CLOCK_KEY = "toolDeck.clock12";
const PRESET_KEY = "toolDeck.utcPresets";
const DEFAULTS = { date: "", order: "21:30", send: "07:30", senddate: "" };

function unusualWait(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 5) return "Wait time is very short (5 minutes or less). Please confirm the target send time is correct.";
  if (m >= 1380 && m < 1500) return "Wait time is almost 24 hours. Please confirm the target send time is set for the correct day.";
  if (m >= 2820 && m < 2940) return "Wait time is almost 48 hours. Please confirm the target send time is set for the correct day.";
  return null;
}

function ResultCard({ icon, title, local, utc, date, accent }) {
  return (
    <div className={`ocard ${accent ? "acc" : ""}`}>
      <div>
        <div className="ot"><span aria-hidden="true">{icon}</span> {title}</div>
        <div className="os">{local} Local</div>
      </div>
      <div className="or">
        <div className="ou">{utc} UTC</div>
        <div className="os">{date}</div>
      </div>
    </div>
  );
}

const LEGACY_KEYS = ["m", "sd", "st", "a", "u", "r", "tz", "tz2"];

export default function UtcTool({ notify }) {
  const P = readParams();
  const today = useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; }, []);
  const [tz, setTz] = useState(() => (isValidZone(P.get("zone")) ? P.get("zone") : USER_TZ));
  const [orderDate, setOrderDate] = useState(() => P.get("date") || today);
  const [orderTime, setOrderTime] = useState(() => P.get("order") || DEFAULTS.order);
  const [sendTime, setSendTime] = useState(() => P.get("send") || DEFAULTS.send);
  const [sendDate, setSendDate] = useState(() => P.get("senddate") || "");
  const [is12, setIs12] = useState(() => { try { return localStorage.getItem(CLOCK_KEY) !== "24"; } catch { return true; } });
  const [skipWk, setSkipWk] = useState(() => P.get("wk") === "1");
  const [showTable, setShowTable] = useState(false);
  const now = useNow(1000);
  const [presets, setPresets] = useState(() => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]").slice(0, 12); } catch { return []; } });
  const [presetName, setPresetName] = useState("");
  const savePresets = (next) => { setPresets(next); try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const addPreset = () => {
    const name = presetName.trim();
    if (!name) return notify("Name the preset first.");
    savePresets([{ name, tz, order: orderTime, send: sendTime, senddate: sendDate, wk: skipWk }, ...presets.filter((p) => p.name !== name)].slice(0, 12));
    setPresetName(""); notify("Preset saved on this device.");
  };
  const applyPreset = (p) => { if (isValidZone(p.tz)) setTz(p.tz); setOrderTime(p.order); setSendTime(p.send); setSendDate(p.senddate || ""); setSkipWk(!!p.wk); };

  useEffect(() => { try { localStorage.setItem(CLOCK_KEY, is12 ? "12" : "24"); } catch { /* storage unavailable */ } }, [is12]);
  useEffect(() => { writeParams(Object.fromEntries(LEGACY_KEYS.map((k) => [k, null]))); }, []);
  useEffect(() => {
    writeParams({ zone: tz, date: orderDate, order: orderTime, send: sendTime, senddate: sendDate || null, wk: skipWk ? "1" : null });
  }, [tz, orderDate, orderTime, sendTime, sendDate, skipWk]);

  const t = (hhmm) => (is12 ? fmt12Str(hhmm) : hhmm);

  const result = useMemo(() => {
    if (!tz || !orderDate || !orderTime || !sendTime) return null;
    try {
      const orderUtc = zonedToUtc(orderDate, orderTime, tz);
      const sendUtc = nextSendUtc(orderUtc, orderDate, sendTime, tz, sendDate, { skipWeekends: skipWk });
      const skipped = skipWk ? skippedWeekendDays(orderUtc, sendTime, tz, sendDate) : [];
      return { orderUtc, sendUtc, waitMs: sendUtc - orderUtc, skipped };
    } catch { return null; }
  }, [tz, orderDate, orderTime, sendTime, sendDate, skipWk]);

  const rows = useMemo(() => buildOrderRows(orderDate, orderTime, sendTime, tz, sendDate, { skipWeekends: skipWk }), [orderDate, orderTime, sendTime, tz, sendDate, skipWk]);

  const warnings = useMemo(() => {
    const w = [];
    if (!orderDate) w.push("Please select an order date.");
    if (!orderTime) w.push("Please enter the order created time.");
    if (!sendTime) w.push("Please enter the target send time.");
    if (orderDate && orderDate < today) w.push("Order date is in the past. The calculator will still find the next valid target send time.");
    const a = orderDate && orderTime && getDateTimeWarning(orderDate, orderTime, tz, "Order created time");
    if (a) w.push(a);
    const b = sendTime && getDateTimeWarning(sendDate || orderDate, sendTime, tz, "Target send time");
    if (b) w.push(b);
    return w;
  }, [orderDate, orderTime, sendTime, sendDate, tz, today]);

  const unusual = result ? unusualWait(result.waitMs) : null;
  const userZoneDiffers = isValidZone(USER_TZ) && USER_TZ !== tz;

  const reset = () => { setTz(USER_TZ); setOrderDate(today); setOrderTime(DEFAULTS.order); setSendTime(DEFAULTS.send); setSendDate(""); setSkipWk(false); };

  const downloadIcs = (sendUtc) => {
    const ics = buildIcs({ title: "Send notification", startUtc: sendUtc, description: `Order placed ${fmtUtcDate(result.orderUtc)} ${fmtUtc(result.orderUtc)} UTC (${tz}).` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "send-time.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    notify("Calendar file downloaded.");
  };

  const copyTable = () => {
    const head = ["Local Date", "Local (12h)", "Local (24h)", "GMT Offset", "UTC Order", "UTC Order Date", "Target UTC", "Target UTC Date", "Wait Time"];
    const text = [head, ...rows.map((r) => [r.localDate, r.local12, r.local24, r.offset, r.utcOrder, r.utcOrderDate, r.targetUtc, r.targetUtcDate, r.wait])]
      .map((r) => r.join("\t")).join("\n");
    navigator.clipboard.writeText(text).then(() => notify("Table copied — ready to paste.")).catch(() => notify("Copy blocked."));
  };

  return (
    <>
      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div><h3>Parameters</h3><p>Set the origin and target local times</p></div>
            <button type="button" className="rowcopy" style={{ width: "auto", padding: "0 10px" }} onClick={reset}>Reset defaults</button>
          </div>
          <div className="pb">
            {warnings.length > 0 && (
              <div className="note w" style={{ marginBottom: 14 }}>
                <b>Check these details</b>
                <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{warnings.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            <div className="field">
              <label>🌍 Country / Time Zone</label>
              <ZonePicker value={tz} onChange={setTz} />
              {userZoneDiffers && (
                <button type="button" className="linkbtn" onClick={() => setTz(USER_TZ)}>📍 Use my timezone ({USER_TZ.split("/").pop().replace(/_/g, " ")})</button>
              )}
            </div>
            <div className="field">
              <label htmlFor="pn">Saved presets</label>
              {presets.length > 0 && (
                <div className="pillrow" style={{ marginBottom: 8 }}>
                  {presets.map((p) => (
                    <span key={p.name} style={{ display: "inline-flex" }}>
                      <button type="button" className="pill" onClick={() => applyPreset(p)} title={`${p.tz} · order ${p.order} · send ${p.send}`}>{p.name}</button>
                      <button type="button" className="pill" aria-label={`Delete preset ${p.name}`} onClick={() => savePresets(presets.filter((x) => x.name !== p.name))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input id="pn" type="text" placeholder="Preset name, e.g. Mexico morning" value={presetName} maxLength={30}
                  onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPreset()} />
                <button type="button" className="btn gh" onClick={addPreset}>Save</button>
              </div>
            </div>
            <div className="field"><label htmlFor="od">Order Date</label><input id="od" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>

            <div className="tgl" style={{ marginBottom: 14 }}>
              <div className="t">Clock format</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ color: is12 ? "var(--tx3)" : "var(--tx)", fontWeight: is12 ? 400 : 700 }}>24h</span>
                <Switch on={is12} onChange={setIs12} label="Use 12-hour clock" />
                <span style={{ color: is12 ? "var(--tx)" : "var(--tx3)", fontWeight: is12 ? 700 : 400 }}>12h</span>
              </div>
            </div>

            <div className="two">
              <div className="field"><label htmlFor="ot">Order Created Time</label><input id="ot" type="time" value={orderTime} onChange={(e) => setOrderTime(e.target.value)} />
                {orderTime && <div className="hint">{t(orderTime)}</div>}</div>
              <div className="field"><label htmlFor="st">Target Send Time</label><input id="st" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                {sendTime && <div className="hint">{t(sendTime)}</div>}</div>
            </div>

            <div className="field">
              <label htmlFor="sd" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Target Send Date (optional)</span>
                <button type="button" className="linkbtn" style={{ margin: 0 }} onClick={() => setSendDate("")}>Clear</button>
              </label>
              <input id="sd" type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
              <div className="hint">Leave blank to automatically pick the next valid day after the order date.</div>
            </div>

            <div className="tgl">
              <div><div className="t">Skip weekends</div><div className="s">Sends that land on Saturday or Sunday move to Monday</div></div>
              <Switch on={skipWk} onChange={setSkipWk} label="Skip weekends" />
            </div>
          </div>
        </div>

        <div className="panel rise d2">
          {!result ? <div className="empty">Please fill all fields to calculate the wait difference.</div> : (
            <div className="pb">
              <div className="bigres" style={{ marginBottom: 16 }}>
                <div className="lab">⏱ Wait difference</div>
                <div className="val">{fmtDurDays(result.waitMs)}</div>
                <div className="sub">
                  {result.sendUtc > now ? <>Sends in <b>{fmtDur(result.sendUtc - now)}</b></> : "This send time has already passed."}
                  {result.skipped.length > 0 && <> · {result.skipped.length} weekend day{result.skipped.length > 1 ? "s" : ""} skipped</>}
                </div>
              </div>
              <ResultCard icon="🕐" title="Order Created" local={fmtLocal(result.orderUtc, tz)} utc={fmtUtc(result.orderUtc)} date={fmtUtcDate(result.orderUtc)} />
              <ResultCard icon="⚡" title="Target Send" accent local={fmtLocal(result.sendUtc, tz)} utc={fmtUtc(result.sendUtc)} date={fmtUtcDate(result.sendUtc)} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" className="btn gh" onClick={() => downloadIcs(result.sendUtc)}>📅 .ics</button>
                <a className="btn gh" style={{ textDecoration: "none" }} target="_blank" rel="noreferrer"
                  href={googleCalendarUrl({ title: "Send notification", startUtc: result.sendUtc, details: `Order placed ${fmtUtcDate(result.orderUtc)} ${fmtUtc(result.orderUtc)} UTC (${tz}).` })}>Google Calendar ↗</a>
                <ShareLink notify={notify} />
              </div>
              {unusual && <div className="note w" style={{ marginTop: 12 }}><b>Unusual wait time · </b>{unusual}</div>}
              <p className="hint" style={{ marginTop: 14 }}>
                The calculator always picks the next valid target send time after the order time, and the table uses each row's local date and GMT offset for daylight-saving accuracy.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="secbar rise d3">
        <h3 />
        <div className="r">
          {showTable && <button className="btn gh" onClick={copyTable} disabled={!rows.length}>⧉ Copy Table</button>}
          <button className="btn gh" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
            {showTable ? "Hide hourly UTC wait table" : "Show hourly UTC wait table"}
          </button>
        </div>
      </div>

      {showTable && (
        <div className="tblwrap rise d3">
          <table className="rt" style={{ minWidth: 980 }}>
            <thead><tr><th>Local Date</th><th>Local (12h)</th><th>Local (24h)</th><th>GMT Offset</th><th>UTC Order</th><th>Target UTC</th><th style={{ textAlign: "right" }}>Wait Time</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.localDate + r.local24} className={i === 0 ? "today" : ""}>
                  <td>{r.localDate}</td>
                  <td><b style={{ color: "var(--tx)" }}>{r.local12}</b>{i === 0 && <span className="chip act" style={{ marginLeft: 10 }}>Order time</span>}</td>
                  <td>{r.local24}</td>
                  <td>{r.offset}</td>
                  <td>{r.utcOrder}<div className="sm">{r.utcOrderDate}</div></td>
                  <td className="c-utc">{r.targetUtc}<div className="sm" style={{ color: "var(--tx3)" }}>{r.targetUtcDate}</div></td>
                  <td style={{ textAlign: "right", color: "var(--tx)", fontWeight: 600 }}>{r.wait}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
