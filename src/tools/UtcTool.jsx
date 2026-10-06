import { useState, useEffect, useMemo } from "react";
import { ShoppingBag, Send, Hourglass, RotateCcw, MapPin, X, Copy, ChevronDown, ExternalLink, Bookmark, Plus, Table2 } from "lucide-react";
import {
  pad, USER_TZ, isValidZone, zonedToUtc, fmtDur,
  fmtUtc, fmtUtcDate, fmtLocal, fmt12Str, fmtDurDays, nextSendUtc, skippedWeekendDays, buildOrderRows, getDateTimeWarning,
} from "../lib/time.js";
import ZonePicker from "../components/ZonePicker.jsx";
import { Switch, ShareLink, copyText } from "../components/chrome.jsx";
import { Notice, EmptyState } from "../components/ui.jsx";
import { readParams, writeParams, useNow } from "../hooks/index.js";
import { buildIcs, googleCalendarUrl } from "../lib/ics.js";
import "./css/utc.css";

const CLOCK_KEY = "toolDeck.clock12";
const PRESET_KEY = "toolDeck.utcPresets";
const DEFAULTS = { date: "", order: "21:30", send: "07:30", senddate: "" };
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isPreset = (p) => p && typeof p.name === "string" && isTime(p.order) && isTime(p.send) && (!p.senddate || isDate(p.senddate));
const safeWarning = (...a) => { try { return getDateTimeWarning(...a); } catch { return null; } };
const cityOf = (tz) => (tz || "").split("/").pop().replace(/_/g, " ");

/* Presentational only: "Sat 11 Jul 2026" for an instant, in a zone (or UTC). */
const dateFmts = new Map();
function fmtDay(d, tz = "UTC") {
  try {
    if (!dateFmts.has(tz)) dateFmts.set(tz, new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", year: "numeric" }));
    const p = Object.fromEntries(dateFmts.get(tz).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  } catch { return tz === "UTC" ? fmtUtcDate(d) : ""; }
}

function unusualWait(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 5) return "Wait time is very short (5 minutes or less). Please confirm the target send time is correct.";
  if (m >= 1380 && m < 1500) return "Wait time is almost 24 hours. Please confirm the target send time is set for the correct day.";
  if (m >= 2820 && m < 2940) return "Wait time is almost 48 hours. Please confirm the target send time is set for the correct day.";
  return null;
}

/** One end of the ORDER → SEND timeline. Local and UTC are separate, labelled rows. */
function MomentCard({ icon: Icon, title, at, tz, is12, accent }) {
  const loc = fmtLocal(at, tz);
  return (
    <li className={`ocard ${accent ? "acc" : ""}`}>
      <div className="oc-h">
        <span className="oc-ic" aria-hidden="true"><Icon size={15} strokeWidth={2.2} /></span>
        <span className="ot">{title}</span>
      </div>
      <dl className="oc-rows">
        <div className="oc-row">
          <dt>Local <span className="oc-z">{cityOf(tz)}</span></dt>
          <dd><span className="oc-t">{is12 ? fmt12Str(loc) : loc}</span><span className="oc-d">{fmtDay(at, tz)}</span></dd>
        </div>
        <div className="oc-row utc">
          <dt>UTC</dt>
          <dd><span className="oc-t ou">{fmtUtc(at)}<small> UTC</small></span><span className="oc-d">{fmtDay(at)}</span></dd>
        </div>
      </dl>
    </li>
  );
}

/* Ticks every second — kept as a leaf so the rest of the tool doesn't re-render. */
function Countdown({ orderUtc, sendUtc }) {
  const now = useNow(1000);
  const total = sendUtc - orderUtc;
  const pct = total > 0 ? Math.min(100, Math.max(0, ((now - orderUtc) / total) * 100)) : 100;
  return (
    <>
      {sendUtc > now ? <>Sends in <b>{fmtDur(sendUtc - now)}</b></> : "This send time has already passed."}
      <span className="utc-prog" aria-hidden="true"><i style={{ "--p": `${pct}%` }} /></span>
    </>
  );
}

const LEGACY_KEYS = ["m", "sd", "st", "a", "u", "r", "tz", "tz2"];

export default function UtcTool({ notify }) {
  const P = readParams();
  const today = useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; }, []);
  const [tz, setTz] = useState(() => (isValidZone(P.get("zone")) ? P.get("zone") : USER_TZ));
  const [orderDate, setOrderDate] = useState(() => (isDate(P.get("date")) ? P.get("date") : today));
  const [orderTime, setOrderTime] = useState(() => (isTime(P.get("order")) ? P.get("order") : DEFAULTS.order));
  const [sendTime, setSendTime] = useState(() => (isTime(P.get("send")) ? P.get("send") : DEFAULTS.send));
  const [sendDate, setSendDate] = useState(() => (isDate(P.get("senddate")) ? P.get("senddate") : ""));
  const [is12, setIs12] = useState(() => { try { return localStorage.getItem(CLOCK_KEY) !== "24"; } catch { return true; } });
  const [skipWk, setSkipWk] = useState(() => P.get("wk") === "1");
  const [showTable, setShowTable] = useState(false);
  const [presets, setPresets] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); return Array.isArray(v) ? v.filter(isPreset).slice(0, 12) : []; } catch { return []; }
  });
  const [presetsOpen, setPresetsOpen] = useState(() => presets.length > 0);
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
    if (sendDate && orderDate && sendDate < orderDate) w.push("Target send date is before the order date. The next valid send time after the order is used instead.");
    const a = orderDate && orderTime && safeWarning(orderDate, orderTime, tz, "Order created time");
    if (a) w.push(a);
    const b = sendTime && safeWarning(sendDate || orderDate, sendTime, tz, "Target send time");
    if (b) w.push(b);
    return w;
  }, [orderDate, orderTime, sendTime, sendDate, tz, today]);

  const unusual = result ? unusualWait(result.waitMs) : null;
  const userZoneDiffers = isValidZone(USER_TZ) && USER_TZ !== tz;
  const wait = result ? fmtDurDays(result.waitMs) : "";
  const skippedN = result ? result.skipped.length : 0;
  const skippedTx = skippedN > 0 ? `${skippedN} weekend day${skippedN > 1 ? "s" : ""} skipped` : "";

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
    copyText(text, notify, "Table copied — ready to paste.");
  };

  const toResult = () => document.getElementById("utc-result")?.scrollIntoView({ block: "start" });

  return (
    <>
      <div className="utc">
        {/* phones: the answer stays in view while the controls are edited */}
        {result && (
          <button type="button" className="utc-peek" onClick={toResult} aria-label={`Wait ${wait}, sends ${fmtUtc(result.sendUtc)} UTC. Jump to the full result`}>
            <Hourglass size={16} aria-hidden="true" />
            <span className="pk-w">{wait}</span>
            <span className="pk-s">→ {fmtUtc(result.sendUtc)} UTC</span>
            <ChevronDown size={16} aria-hidden="true" className="pk-c" />
          </button>
        )}

        <div className="grid2">
          <div className="panel utc-cfg rise d1">
            <div className="ph utc-ph">
              <div><h2>Schedule</h2><p>Times are local to the chosen zone</p></div>
              <button type="button" className="btn qt sm" onClick={reset}><RotateCcw size={14} aria-hidden="true" />Reset defaults</button>
            </div>
            <div className="pb">
              {warnings.length > 0 && (
                <Notice tone="w" title="Check these details" className="utc-warn">
                  <ul>{warnings.map((m) => <li key={m}>{m}</li>)}</ul>
                </Notice>
              )}

              <div className="field">
                <label id="tzl">Country / time zone</label>
                <ZonePicker value={tz} onChange={setTz} labelledBy="tzl" />
                {userZoneDiffers && (
                  <button type="button" className="linkbtn utc-mine" onClick={() => setTz(USER_TZ)}>
                    <MapPin size={13} aria-hidden="true" />Use my time zone ({cityOf(USER_TZ)})
                  </button>
                )}
              </div>

              <fieldset className="utc-step">
                <legend><span className="st-dot" aria-hidden="true"><ShoppingBag size={12} strokeWidth={2.4} /></span>Order</legend>
                <div className="two">
                  <div className="field"><label htmlFor="od">Order date</label><input id="od" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
                  <div className="field"><label htmlFor="ot">Order created time</label><input id="ot" type="time" value={orderTime} onChange={(e) => setOrderTime(e.target.value)} aria-describedby="ot-h" />
                    {orderTime && <div className="hint mono-h" id="ot-h">{t(orderTime)}</div>}</div>
                </div>
              </fieldset>

              <fieldset className="utc-step send">
                <legend><span className="st-dot" aria-hidden="true"><Send size={12} strokeWidth={2.4} /></span>Send</legend>
                <div className="two">
                  <div className="field"><label htmlFor="st">Target send time</label><input id="st" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} aria-describedby="st-h" />
                    {sendTime && <div className="hint mono-h" id="st-h">{t(sendTime)}</div>}</div>
                  <div className="field">
                    <div className="lbl-row">
                      <label htmlFor="sd">Send date <span className="opt">optional</span></label>
                      {sendDate && <button type="button" className="linkbtn utc-clear" onClick={() => setSendDate("")} aria-label="Clear target send date">Clear</button>}
                    </div>
                    <input id="sd" type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} aria-describedby="sd-h" />
                  </div>
                </div>
                <div className="hint utc-sdh" id="sd-h">Leave the send date blank to pick the next valid day after the order.</div>
              </fieldset>

              <div className="utc-opts">
                <div className="tgl">
                  <div><div className="t">Skip weekends</div><div className="s">Sends that land on Saturday or Sunday move to Monday</div></div>
                  <Switch on={skipWk} onChange={setSkipWk} label="Skip weekends" />
                </div>
                <div className="tgl">
                  <div className="t" id="clk-l">Clock format</div>
                  <div className="seg utc-seg" role="group" aria-labelledby="clk-l">
                    <button type="button" aria-pressed={!is12} onClick={() => setIs12(false)}>24h</button>
                    <button type="button" aria-pressed={is12} onClick={() => setIs12(true)}>12h</button>
                  </div>
                </div>
              </div>

              <details className="more utc-presets" open={presetsOpen} onToggle={(e) => setPresetsOpen(e.currentTarget.open)}>
                <summary><Bookmark size={14} aria-hidden="true" />Saved presets{presets.length > 0 && <span className="badge">{presets.length}</span>}</summary>
                <div className="utc-pbody">
                  {presets.length > 0 ? (
                    <ul className="utc-chips" aria-label="Saved presets">
                      {presets.map((p) => (
                        <li key={p.name} className="utc-chip">
                          <button type="button" className="cp-apply" onClick={() => applyPreset(p)} title={`${p.tz} · order ${p.order} · send ${p.send}`}>{p.name}</button>
                          <button type="button" className="cp-del" aria-label={`Delete preset ${p.name}`} onClick={() => savePresets(presets.filter((x) => x.name !== p.name))}><X size={13} aria-hidden="true" /></button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="hint utc-none">No presets yet. Save this zone and these times to reuse them in one tap.</p>}
                  <label htmlFor="pn" className="sr-only">Preset name</label>
                  <div className="inrow utc-save">
                    <input id="pn" className="inp" type="text" placeholder="Name, e.g. Mexico morning" value={presetName} maxLength={30}
                      onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPreset()} />
                    <button type="button" className="btn gh" onClick={addPreset}><Plus size={14} aria-hidden="true" />Save</button>
                  </div>
                  <p className="hint">Saved on this device only.</p>
                </div>
              </details>
            </div>
          </div>

          <section className="panel sticky utc-res rise d2" id="utc-result" aria-label="Result">
            {!result ? (
              <EmptyState icon={Hourglass} title="Nothing to calculate yet">Fill in the time zone, order date and both times to see when to send.</EmptyState>
            ) : (
              <div className="pb">
                <p className="sr-only" aria-live="polite" aria-atomic="true">{`Wait ${wait}. Sends ${fmtUtc(result.sendUtc)} UTC, ${fmtLocal(result.sendUtc, tz)} local.`}</p>
                <div className="bigres utc-big">
                  <div className="lab"><Hourglass size={12} aria-hidden="true" />Wait difference</div>
                  <div className="val">{wait}</div>
                  <div className="sub">
                    <Countdown orderUtc={result.orderUtc} sendUtc={result.sendUtc} />
                  </div>
                </div>

                <ol className="utc-tl" aria-label="Order to send timeline">
                  <MomentCard icon={ShoppingBag} title="Order created" at={result.orderUtc} tz={tz} is12={is12} />
                  <li className="utc-gap" aria-label={`Wait ${wait}${skippedTx ? `, ${skippedTx}` : ""}`}>
                    <span className="g-tx" aria-hidden="true">waits <b>{wait}</b></span>
                    {skippedTx && <span className="chip wk" aria-hidden="true">{skippedTx}</span>}
                  </li>
                  <MomentCard icon={Send} title="Target send" accent at={result.sendUtc} tz={tz} is12={is12} />
                </ol>

                {unusual && <Notice tone="w" title="Unusual wait time" className="utc-unusual">{unusual}</Notice>}

                <div className="utc-acts">
                  <span className="eyebrow" id="cal-l">Add to calendar</span>
                  <div className="actions" role="group" aria-labelledby="cal-l">
                    <button type="button" className="btn gh sm" onClick={() => downloadIcs(result.sendUtc)}>📅 .ics</button>
                    <a className="btn gh sm" target="_blank" rel="noreferrer"
                      href={googleCalendarUrl({ title: "Send notification", startUtc: result.sendUtc, details: `Order placed ${fmtUtcDate(result.orderUtc)} ${fmtUtc(result.orderUtc)} UTC (${tz}).` })}>
                      Google Calendar<ExternalLink size={13} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
                    </a>
                    <ShareLink notify={notify} />
                  </div>
                </div>
                <p className="hint utc-foot">
                  The calculator always picks the next valid target send time after the order time, and the table uses each row's local date and GMT offset for daylight-saving accuracy.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="secbar utc-bar rise d3">
        <div>
          <h2><Table2 size={15} aria-hidden="true" />Next 24 hours</h2>
          <p className="hint">The wait for an order placed at each hour from the order time.</p>
        </div>
        <div className="r">
          {showTable && <button type="button" className="btn gh" onClick={copyTable} disabled={!rows.length}><Copy size={14} aria-hidden="true" />Copy table</button>}
          <button type="button" className="btn gh" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable} aria-controls="utc-tbl">
            {showTable ? "Hide hourly UTC wait table" : "Show hourly UTC wait table"}
            <ChevronDown size={14} aria-hidden="true" className={`utc-chev ${showTable ? "up" : ""}`} />
          </button>
        </div>
      </div>

      {showTable && (
        <div className="tblwrap utc-tbl rise d3" id="utc-tbl" tabIndex={0} role="region" aria-label="Hourly UTC wait table">
          <table className="rt">
            <thead><tr><th scope="col">Local date</th><th scope="col">Local (12h)</th><th scope="col">Local (24h)</th><th scope="col">GMT offset</th><th scope="col">UTC order</th><th scope="col">Target UTC</th><th scope="col" className="num">Wait time</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.localDate + r.local24} className={i === 0 ? "today" : ""} aria-current={i === 0 ? "true" : undefined}>
                  <td>{r.localDate}</td>
                  <td className="c-loc"><b>{r.local12}</b>{i === 0 && <span className="chip act utc-now">Order time</span>}</td>
                  <td>{r.local24}</td>
                  <td>{r.offset}</td>
                  <td>{r.utcOrder}<div className="sm">{r.utcOrderDate}</div></td>
                  <td className="c-utc">{r.targetUtc}<div className="sm">{r.targetUtcDate}</div></td>
                  <td className="num w">{r.wait}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
