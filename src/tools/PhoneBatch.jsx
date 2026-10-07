import { useState, useMemo, useRef, useEffect } from "react";
import { Upload, Download, Loader2 } from "lucide-react";
import { analyzeNumber, nationalToE164 } from "../lib/phoneCheck.js";
import { detectPhone, flagOf, REGION_INFO, REGION_LIST } from "../lib/phone.js";
import { fmtLocal, zoneParts } from "../lib/time.js";
import { CopyButton } from "../components/ui.jsx";
import { callWindow } from "../lib/phoneCall.js";

export const BATCH_MAX = 5000;
const CHUNK = 100; // rows per tick: keeps typing and scrolling smooth on big lists
const SHOW_MAX = 300; // rows rendered at once; CSV export always has every row

/* One number per line; spreadsheet pastes (tabs, commas, semicolons) split too. */
export const splitNumbers = (text) => text.split(/[\r\n\t,;]+/).map((l) => l.trim()).filter(Boolean);

let regionNames;
function regionName(iso) {
  if (REGION_INFO[iso]) return REGION_INFO[iso].name;
  try { regionNames ||= new Intl.DisplayNames(["en"], { type: "region" }); return regionNames.of(iso) || iso; } catch { return iso; }
}

async function lookup(line, region) {
  let det = detectPhone(line);
  if (det && det.trunk && region) {
    const e164 = await nationalToE164(det.digits, region).catch(() => null);
    if (e164) det = { ...detectPhone(e164), ext: det.ext };
  }
  if (!det || !det.e164) return { input: line, status: det && det.trunk ? "Needs country" : "Not detected", good: false };
  const info = await analyzeNumber(det.e164).catch(() => null);
  // libphonenumber knows sub-regions the prefix table folds together (+1 islands, +44 Isle of Man).
  const iso = info && info.country ? info.country : det.iso;
  const zone = iso === det.iso ? det.zone : (REGION_INFO[iso] && REGION_INFO[iso].zone) || det.zone;
  return {
    input: line, e164: det.e164, iso, zone, flag: flagOf(iso), country: iso === det.iso ? det.name : regionName(iso),
    intl: info && info.valid ? info.international : det.intl, type: info && info.valid ? info.typeLabel || "Unknown" : "",
    status: !info ? "Unchecked" : info.valid ? "Valid" : info.possible ? "Not allocated" : "Wrong length",
    good: !!(info && info.valid),
  };
}

const csvCell = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));

function toCsv(rows) {
  const now = new Date();
  return ["Input,Status,Country,ISO,E.164,International,Type,Local time,Call window,Duplicate",
    ...rows.map((r) => {
      const t = r.zone ? fmtLocal(now, r.zone) : "";
      const w = r.zone ? callWindow(zoneParts(now, r.zone).hour)[1] : "";
      return [r.input, r.status, r.country, r.iso, r.e164, r.intl, r.type, t, w, r.dup ? "yes" : ""].map(csvCell).join(",");
    })].join("\n");
}

const FILTERS = [["all", "All"], ["valid", "Valid"], ["bad", "Problems"], ["dup", "Duplicates"]];

export default function PhoneBatch({ notify }) {
  const [text, setText] = useState("");
  const [region, setRegion] = useState("");
  const [rows, setRows] = useState(null);
  const [progress, setProgress] = useState(null); // null = idle, else rows done
  const [filter, setFilter] = useState("all");
  const runId = useRef(0);
  const lines = useMemo(() => splitNumbers(text), [text]);
  const todo = Math.min(lines.length, BATCH_MAX);

  useEffect(() => () => { runId.current++; }, []); // stop a running batch on unmount

  async function run() {
    const id = ++runId.current;
    const list = lines.slice(0, BATCH_MAX);
    // Same input text is looked up once.
    const cache = new Map(), out = [];
    setProgress(0); setFilter("all");
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = await Promise.all(list.slice(i, i + CHUNK).map((l) => {
        if (!cache.has(l)) cache.set(l, lookup(l, region));
        return cache.get(l);
      }));
      if (id !== runId.current) return; // edited or restarted mid-run
      out.push(...part.map((r) => ({ ...r })));
      setProgress(out.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    const seen = new Set();
    for (const r of out) { const k = r.e164 || r.input; r.dup = seen.has(k); seen.add(k); }
    setRows(out); setProgress(null);
  }

  function loadFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2e6) { notify("That file is over 2 MB — paste a smaller list."); return; }
    f.text().then((t) => { setText(t); setRows(null); }).catch(() => notify("Couldn't read that file."));
  }

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    a.download = "phone-numbers.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const counts = rows && { all: rows.length, valid: rows.filter((r) => r.good && !r.dup).length,
    bad: rows.filter((r) => !r.good).length, dup: rows.filter((r) => r.dup).length };
  const shown = rows ? rows.filter((r) => filter === "all" || (filter === "valid" ? r.good && !r.dup : filter === "bad" ? !r.good : r.dup)) : [];
  const validE164 = rows ? [...new Set(rows.filter((r) => r.good).map((r) => r.e164))].join("\n") : "";
  const busy = progress !== null;

  return (
    <div className="ph-batch">
      <div className="field">
        <label htmlFor="ph-batch">Numbers — one per line</label>
        <textarea id="ph-batch" className="mono" rows={7} value={text} spellCheck={false} aria-describedby="ph-bhint"
          onChange={(e) => { setText(e.target.value); setRows(null); runId.current++; setProgress(null); }}
          placeholder={"+91 98765 43210\n+1 416 555 0199\n020 7183 8750"} />
        <p className="hint" id="ph-bhint">
          {lines.length} number{lines.length === 1 ? "" : "s"}
          {lines.length > BATCH_MAX ? ` — only the first ${BATCH_MAX} are checked` : ""}. Pasting a spreadsheet column works too.
        </p>
      </div>
      <div className="ph-brow">
        <div className="field">
          <label htmlFor="ph-bregion">Country for numbers without +</label>
          <select id="ph-bregion" value={region} onChange={(e) => { setRegion(e.target.value); setRows(null); }}>
            <option value="">None — skip them</option>
            {REGION_LIST.map((r) => <option key={r.iso} value={r.iso}>{r.name}</option>)}
          </select>
        </div>
        <label className="btn gh ph-file">
          <Upload size={14} aria-hidden="true" />Load .txt / .csv
          <input type="file" accept=".txt,.csv,text/plain,text/csv" className="sr-only" onChange={loadFile} />
        </label>
      </div>
      <button type="button" className="btn pri" disabled={!todo || busy} onClick={run}>
        {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" />Checking {progress} / {todo}</> : `Check ${todo || ""} number${todo === 1 ? "" : "s"}`}
      </button>
      {busy && <progress className="ph-prog" max={todo} value={progress} aria-label="Batch progress" />}

      {rows && (
        <section className="ph-bres" aria-label="Batch results">
          <p className="sr-only" aria-live="polite">{counts.valid} valid of {counts.all}</p>
          <div className="ph-btools">
            <div className="seg" role="group" aria-label="Show">
              {FILTERS.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="ph-n">{counts[k]}</span></button>
              ))}
            </div>
            <div className="ph-bacts">
              <CopyButton text={validE164} className="btn gh sm" notify={notify} toast="Valid numbers copied (E.164, de-duplicated)."
                label="Copy valid" done="Copied" />
              <CopyButton text={() => toCsv(rows)} className="btn gh sm" notify={notify} toast="CSV copied." label="Copy CSV" done="Copied" />
              <button type="button" className="btn gh sm" onClick={download}><Download size={14} aria-hidden="true" />CSV</button>
            </div>
          </div>
          <div className="tblwrap">
            <table className="rt ph-tbl">
              <thead><tr><th>Input</th><th>Status</th><th>Country</th><th>E.164</th><th>Type</th></tr></thead>
              <tbody>
                {shown.slice(0, SHOW_MAX).map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.input}</td>
                    <td className={r.good ? "ph-ok" : "ph-bad"}>{r.status}{r.dup ? " · dup" : ""}</td>
                    <td>{r.flag} {r.country || "—"}</td>
                    <td className="mono">{r.e164 || "—"}</td>
                    <td>{r.type || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > SHOW_MAX && <p className="hint">Showing {SHOW_MAX} of {shown.length} — the CSV has every row.</p>}
        </section>
      )}
    </div>
  );
}
