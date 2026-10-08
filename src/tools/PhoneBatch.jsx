import { useState, useMemo, useRef, useEffect } from "react";
import { Upload, Download, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { analyzeNumber, nationalToE164 } from "../lib/phoneCheck.js";
import { detectPhone, flagOf, REGION_INFO, REGION_LIST } from "../lib/phone.js";
import { CopyButton } from "../components/ui.jsx";
import { rowTimes, sortRows, nextSort, loadDraft, saveDraft } from "../lib/phoneBatch.js";
import { csvCell, CSV_BOM } from "../lib/csv.js";
import { useNow } from "../hooks/index.js";

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

function toCsv(rows) {
  const now = new Date();
  return ["Input,Status,Country,ISO,E.164,International,Type,Local time,Call window,Duplicate",
    ...rows.map((r) => {
      const t = rowTimes(r.zone, now);
      return [r.input, r.status, r.country, r.iso, r.e164, r.intl, r.type, t.local, t.window, r.dup ? "yes" : ""].map(csvCell).join(",");
    })].join("\n");
}

const FILTERS = [["all", "All"], ["valid", "Valid"], ["bad", "Problems"], ["dup", "Duplicates"]];
const COLS = [["input", "Input"], ["status", "Status"], ["country", "Country"], ["e164", "E.164"], ["type", "Type"], ["local", "Local time"], ["call", "Call window"]];

/* Re-renders once a minute for the local-time columns — a leaf so the textarea doesn't. */
function BatchTable({ rows, sort, onSort }) {
  const now = useNow(60000);
  const times = useMemo(() => new Map(rows.map((r) => [r, rowTimes(r.zone, now)])), [rows, now]);
  const list = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir, (r) => times.get(r)) : rows), [rows, sort, times]);
  return (
    <>
      <div className="tblwrap">
        <table className="rt ph-tbl">
          <thead>
            <tr>
              {COLS.map(([k, l]) => {
                const on = sort && sort.key === k;
                const Ic = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th key={k} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <button type="button" className={`ph-sort ${on ? "on" : ""}`} onClick={() => onSort(k)}>
                      {l}<Ic size={12} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, SHOW_MAX).map((r, i) => {
              const t = times.get(r);
              return (
                <tr key={i}>
                  <td className="mono">{r.input}</td>
                  <td className={r.good ? "ph-ok" : "ph-bad"}>{r.status}{r.dup ? " · dup" : ""}</td>
                  <td>{r.flag} {r.country || "—"}</td>
                  <td className="mono">{r.e164 || "—"}</td>
                  <td>{r.type || "—"}</td>
                  <td className="mono">{t.local || "—"}</td>
                  <td>{t.tone ? <span className={`ph-cw ${t.tone}`} title={t.window}><span className="dot" aria-hidden="true" />{t.label}</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > SHOW_MAX && <p className="hint">Showing {SHOW_MAX} of {list.length} — the CSV has every row.</p>}
    </>
  );
}

const session = () => { try { return window.sessionStorage; } catch { return null; } };

export default function PhoneBatch({ notify }) {
  // The draft survives mode switches and reloads in this tab (results are re-checked on demand).
  const [draft] = useState(() => { const st = session(); return st ? loadDraft(st) : null; });
  const [text, setText] = useState(() => (draft ? draft.text : ""));
  const [region, setRegion] = useState(() => (draft ? draft.region : ""));
  const [rows, setRows] = useState(null);
  const [progress, setProgress] = useState(null); // null = idle, else rows done
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(null); // null = input order
  const runId = useRef(0);
  const lines = useMemo(() => splitNumbers(text), [text]);
  const todo = Math.min(lines.length, BATCH_MAX);
  const latest = useRef({ text, region });
  latest.current = { text, region };

  useEffect(() => () => { runId.current++; }, []); // stop a running batch on unmount
  // Debounced while typing; flushed on unmount so a quick mode switch keeps the last keystroke.
  useEffect(() => {
    const id = setTimeout(() => { const st = session(); if (st) saveDraft(st, { text, region }); }, 400);
    return () => clearTimeout(id);
  }, [text, region]);
  useEffect(() => () => { const st = session(); if (st) saveDraft(st, latest.current); }, []);

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
    a.href = URL.createObjectURL(new Blob([CSV_BOM + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    a.download = "phone-numbers.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const counts = rows && { all: rows.length, valid: rows.filter((r) => r.good && !r.dup).length,
    bad: rows.filter((r) => !r.good).length, dup: rows.filter((r) => r.dup).length };
  const shown = useMemo(() => (rows ? rows.filter((r) => filter === "all" || (filter === "valid" ? r.good && !r.dup : filter === "bad" ? !r.good : r.dup)) : []), [rows, filter]);
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
          <BatchTable rows={shown} sort={sort} onSort={(k) => setSort((cur) => nextSort(cur, k))} />
        </section>
      )}
    </div>
  );
}
