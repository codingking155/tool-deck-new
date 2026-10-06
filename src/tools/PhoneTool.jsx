import { useState, useEffect, useMemo } from "react";
import { analyzeNumber, validityText, nationalToE164 } from "../lib/phoneCheck.js";
import { detectPhone, flagOf, REGION_INFO, REGION_LIST } from "../lib/phone.js";
import { fmtLocal, offsetLabel, offsetMinutes, zoneParts, DAYS, USER_TZ } from "../lib/time.js";
import { useNow, readParams, writeParams } from "../hooks/index.js";

const SAMPLES = ["+91 98765 43210", "+1 416 555 0199", "+44 20 7183 8750", "+81 3 1234 5678"];
const BATCH_MAX = 500;

/* Region for national-format numbers ("020 …"): the URL, else the browser locale, else US. */
function defaultRegion() {
  const fromUrl = (readParams().get("c") || "").toUpperCase();
  if (REGION_INFO[fromUrl]) return fromUrl;
  for (const l of navigator.languages || [navigator.language]) {
    const r = (String(l).split("-")[1] || "").toUpperCase();
    if (REGION_INFO[r]) return r;
  }
  return "US";
}

let regionNames;
function regionName(iso) {
  if (REGION_INFO[iso]) return REGION_INFO[iso].name;
  try { regionNames ||= new Intl.DisplayNames(["en"], { type: "region" }); return regionNames.of(iso) || iso; } catch { return iso; }
}

/* Detect, convert a national number via the chosen region, then validate with libphonenumber. */
async function lookup(line, region) {
  let det = detectPhone(line);
  if (det && det.trunk) {
    const e164 = await nationalToE164(det.digits, region).catch(() => null);
    if (e164) det = { ...detectPhone(e164), ext: det.ext, fromRegion: region };
  }
  const info = det && det.e164 ? await analyzeNumber(det.e164).catch(() => null) : null;
  return { input: line, det, info };
}

/* libphonenumber knows sub-regions the prefix table folds together (+7 KZ, +44 Isle of Man, NANP islands). */
function placeOf(det, info) {
  const iso = info && info.country && info.country !== det.iso ? info.country : det.iso;
  if (iso === det.iso) return { iso, name: det.name, flag: det.flag, zone: det.zone };
  return { iso, name: regionName(iso), flag: flagOf(iso), zone: (REGION_INFO[iso] && REGION_INFO[iso].zone) || det.zone };
}

function callWindow(hour) {
  if (hour >= 9 && hour < 18) return ["good", "Business hours there — a good time to call"];
  if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 21)) return ["warn", "Outside office hours there"];
  return ["bad", "Night-time there — they're probably asleep"];
}

function diffText(mins) {
  if (mins === 0) return "same time as you";
  const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""} ${mins > 0 ? "ahead of" : "behind"} you`;
}

/* Leaf component: the only part of the tool that re-renders every second. */
function LocalTime({ zone }) {
  const now = useNow(1000);
  const p = zoneParts(now, zone);
  const dow = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const [tone, text] = callWindow(p.hour);
  const diff = offsetMinutes(zone, now) - offsetMinutes(USER_TZ, now);
  return (
    <>
      <div className="kv"><span className="k">Local time</span>
        <span className="v phwrap">{dow} {fmtLocal(now, zone)} ({offsetLabel(zone, now)}) · {diffText(diff)}</span></div>
      <div className="kv"><span className="k">Timezone</span><span className="v">{zone}</span></div>
      <div className={`phcall ${tone}`} role="status"><span className="dot" aria-hidden="true" />{text}</div>
    </>
  );
}

function Row({ k, v, hl, onCopy }) {
  return (
    <div className="kv"><span className="k">{k}</span>
      <span className="v phv"><span className={hl ? "hl" : undefined}>{v}</span>
        <button type="button" className="phcp" onClick={() => onCopy(v, k)} aria-label={`Copy ${k}`} title="Copy">⧉</button></span>
    </div>
  );
}

function Result({ det, info, notify }) {
  const copy = (t, l) => navigator.clipboard.writeText(t).then(() => notify(`${l} copied.`)).catch(() => notify("Copy blocked."));
  const place = placeOf(det, info);
  const valid = info ? info.valid : null;
  const intl = info && info.valid ? info.international : det.intl;
  const digits = det.e164.slice(1);
  return (
    <div style={{ marginTop: 16 }}>
      <div className="phbox">
        <div className="phflag" aria-hidden="true">{place.flag}</div>
        <div style={{ minWidth: 0 }}>
          <h3>{place.name}</h3>
          <div className="m">
            +{det.dial}{det.area ? ` (area ${det.area})` : ""} · {" "}
            {info ? <span className={valid ? "ok" : "bad"}>{validityText(info)}</span> : "Checking…"}
            {info && valid ? ` · ${info.typeLabel || "Type unknown"}` : ""}
            {det.assumed && !det.fromRegion ? " · + prefix assumed" : ""}
            {det.fromRegion ? ` · read as a ${regionName(det.fromRegion)} number` : ""}
          </div>
        </div>
      </div>
      {info && !valid && (
        <div className="note w" style={{ marginTop: 12, marginBottom: 0 }}>
          <b>Double-check this number · </b>{info.possible
            ? `it has the right length but isn't in any range allocated in ${place.name}.`
            : `it's the wrong length for ${place.name} — a digit may be missing or extra.`}
          {det.assumed && !det.fromRegion ? " Add a + and the country code if it's from somewhere else." : ""}
        </div>
      )}
      <div className="panel" style={{ marginTop: 12 }}>
        <Row k="International" v={intl} hl onCopy={copy} />
        <Row k="E.164" v={det.e164} onCopy={copy} />
        {info && valid && <Row k="National" v={info.national} onCopy={copy} />}
        {info && valid && <Row k="RFC 3966 (tel: URI)" v={info.rfc3966} onCopy={copy} />}
        {det.ext && <Row k="Extension" v={det.ext} onCopy={copy} />}
        <LocalTime zone={place.zone} />
      </div>
      <div className="pillrow" style={{ marginTop: 12 }}>
        <button className="pill" onClick={() => copy(det.e164, "Number")}>⧉ Copy number</button>
        <a className="pill" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">WhatsApp ↗</a>
        <a className="pill" href={`https://t.me/+${digits}`} target="_blank" rel="noreferrer">Telegram ↗</a>
        <a className="pill" href={`sms:${det.e164}`}>Send SMS</a>
        <a className="pill" href={`tel:${det.e164}${det.ext ? `;ext=${det.ext}` : ""}`}>Call</a>
        <button className="pill" onClick={() => copy(window.location.href, "Link")}>🔗 Share link</button>
      </div>
    </div>
  );
}

function RegionSelect({ id, region, setRegion }) {
  return (
    <select id={id} value={region} onChange={(e) => setRegion(e.target.value)}>
      {REGION_LIST.map((r) => <option key={r.iso} value={r.iso}>{flagOf(r.iso)} {r.name}</option>)}
    </select>
  );
}

function Single({ notify, region, setRegion }) {
  const [input, setInput] = useState(() => readParams().get("n") || "");
  const det = useMemo(() => detectPhone(input), [input]);
  const trunk = !!(det && det.trunk);
  useEffect(() => { writeParams({ n: input.trim() || null, c: trunk ? region : null }); }, [input, trunk, region]);
  const [res, setRes] = useState(null);
  const key = det && (det.e164 || (det.trunk && `${det.digits}@${region}`));
  useEffect(() => {
    setRes(null);
    if (!key) return;
    let live = true;
    lookup(input, region).then((r) => live && setRes(r));
    return () => { live = false; };
  }, [key]); // `key` captures input + region
  const shown = res && res.det && res.det.e164 ? res : det && det.e164 ? { det, info: null } : null;
  return (
    <>
      <div className="phinp">
        <input className="inp" style={{ height: 56, fontSize: 20 }} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={input}
          aria-label="Phone number" onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t && t.includes("\n")) { e.preventDefault(); setInput(t.split("\n").find((l) => l.trim()) || ""); } }} />
        {input && <button type="button" className="phclr" onClick={() => setInput("")} aria-label="Clear">✕</button>}
      </div>
      <div className="pillrow">
        {SAMPLES.map((s) => <button key={s} className="pill" onClick={() => setInput(s)}>{s}</button>)}
      </div>
      {trunk && (
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label htmlFor="ph-region">Country this number is from</label>
          <RegionSelect id="ph-region" region={region} setRegion={setRegion} />
          {res && !res.det.e164 && <div className="hint">Not a possible {regionName(region)} number — try another country or add the + prefix.</div>}
        </div>
      )}
      {det && det.error && !trunk && input.trim() && <div className="note w" style={{ marginTop: 16 }}><b>Can't detect · </b>{det.error}</div>}
      {shown && <Result det={shown.det} info={shown.info} notify={notify} />}
    </>
  );
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));

function Batch({ notify, region, setRegion }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [text]);
  const run = async () => {
    setBusy(true);
    try { setRows(await Promise.all(lines.slice(0, BATCH_MAX).map((l) => lookup(l, region)))); } finally { setBusy(false); }
  };
  const table = (rows || []).map(({ input, det, info }) => {
    const ok = det && det.e164;
    const place = ok ? placeOf(det, info) : null;
    return {
      input, flag: place ? place.flag : "", country: place ? place.name : "—", iso: place ? place.iso : "",
      e164: ok ? det.e164 : "", intl: ok ? (info && info.valid ? info.international : det.intl) : "",
      type: info && info.valid ? info.typeLabel || "Unknown" : "",
      status: !ok ? (det && det.trunk ? "Needs country" : "Not detected") : !info ? "Unchecked" : info.valid ? "Valid" : info.possible ? "Not allocated" : "Wrong length",
      good: !!(info && info.valid),
    };
  });
  const csv = () => ["Input,Country,ISO,E.164,International,Type,Status",
    ...table.map((r) => [r.input, r.country, r.iso, r.e164, r.intl, r.type, r.status].map(csvCell).join(","))].join("\n");
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv()], { type: "text/csv" }));
    a.download = "phone-numbers.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const validCount = table.filter((r) => r.good).length;
  return (
    <>
      <div className="field">
        <label htmlFor="ph-batch">Numbers — one per line</label>
        <textarea id="ph-batch" value={text} onChange={(e) => setText(e.target.value)} style={{ height: 170 }}
          placeholder={"+91 98765 43210\n+1 416 555 0199\n020 7183 8750"} />
        <div className="hint">{lines.length} number{lines.length === 1 ? "" : "s"}{lines.length > BATCH_MAX ? ` — only the first ${BATCH_MAX} are checked` : ""}</div>
      </div>
      <div className="field">
        <label htmlFor="ph-bregion">Country for numbers without a + prefix</label>
        <RegionSelect id="ph-bregion" region={region} setRegion={setRegion} />
      </div>
      <button className="btn pri" disabled={!lines.length || busy} onClick={run}>{busy ? "Checking…" : `Look up ${Math.min(lines.length, BATCH_MAX) || ""} number${lines.length === 1 ? "" : "s"}`}</button>
      {rows && (
        <div style={{ marginTop: 16 }}>
          <div className="pillrow" style={{ alignItems: "center", marginTop: 0, marginBottom: 10 }}>
            <span className="hint" style={{ margin: "0 auto 0 0" }}>{validCount} of {table.length} valid</span>
            <button className="pill" onClick={() => navigator.clipboard.writeText(csv()).then(() => notify("CSV copied.")).catch(() => notify("Copy blocked."))}>⧉ Copy CSV</button>
            <button className="pill" onClick={download}>⤓ Download CSV</button>
          </div>
          <div className="tblwrap">
            <table className="rt" style={{ minWidth: 600 }}>
              <thead><tr><th>Input</th><th>Status</th><th>Country</th><th>E.164</th><th>Type</th></tr></thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={i}>
                    <td>{r.input}</td><td className={r.good ? "phok" : "phbad"}>{r.status}</td>
                    <td>{r.flag} {r.country}</td><td>{r.e164 || "—"}</td><td>{r.type || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default function PhoneTool({ notify }) {
  const [mode, setMode] = useState("single");
  const [region, setRegion] = useState(defaultRegion);
  return (
    <div className="grid2" style={{ gridTemplateColumns: "1fr", maxWidth: 680, margin: "0 auto" }}>
      <div className="panel rise d1">
        <div className="ph phhead">
          <div><h2>{mode === "single" ? "Enter a phone number" : "Check a list of numbers"}</h2>
            <p>Country from the dialing prefix, then validated against Google's libphonenumber ranges.</p></div>
          <div className="pillrow" role="group" aria-label="Mode" style={{ marginTop: 0 }}>
            <button className="pill" aria-pressed={mode === "single"} onClick={() => setMode("single")}>Single</button>
            <button className="pill" aria-pressed={mode === "batch"} onClick={() => setMode("batch")}>Batch</button>
          </div>
        </div>
        <div className="pb">
          {mode === "single"
            ? <Single notify={notify} region={region} setRegion={setRegion} />
            : <Batch notify={notify} region={region} setRegion={setRegion} />}
          <div className="note i" style={{ marginTop: 18, marginBottom: 0 }}>
            <b>What this shows · </b>the numbering country or region a number belongs to. It can never reveal the owner,
            the live location, or where the phone physically is right now. Numbers are checked in your browser and never sent anywhere.
          </div>
        </div>
      </div>
    </div>
  );
}
