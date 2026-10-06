import { memo, useState, useMemo, useDeferredValue, useEffect } from "react";
import { Search, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, TextSearch, Plus, Minus, PenLine } from "lucide-react";
import { BigNum, isContainer, formatPath, stringify, diffJSON } from "../lib/jsonCore.js";
import { CopyButton, StatusBadge, Notice } from "../components/ui.jsx";

const CHUNK = 100;
const SEARCH_NODE_CAP = 2000000;
const ROW_CAP = 5000; // "Expand all" on a big document would otherwise mount ~1M rows

function entriesOf(v) {
  return Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
}

/* Paths of nodes whose key or scalar value contains q, plus all their ancestors. */
function findMatches(root, q) {
  const hits = new Set(), anc = new Set();
  let seen = 0, capped = false;
  /* segs is a shared stack; a path string is only built for hits and their ancestors. */
  const segs = [];
  const visit = (k, v) => {
    if (++seen > SEARCH_NODE_CAP) { capped = true; return false; }
    let hit = k !== null && String(k).toLowerCase().includes(q);
    let below = false;
    if (isContainer(v)) {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) { segs.push(i); if (visit(i, v[i])) below = true; segs.pop(); }
      } else {
        for (const ck of Object.keys(v)) { segs.push(ck); if (visit(ck, v[ck])) below = true; segs.pop(); }
      }
    } else if (!hit) {
      hit = String(v instanceof BigNum ? v.raw : v).toLowerCase().includes(q);
    }
    if (hit) hits.add(formatPath(segs));
    if (below) anc.add(formatPath(segs));
    return hit || below;
  };
  visit(null, root);
  return { hits, anc, capped };
}

function buildRows(root, { depthOpen, over, shown, match }) {
  const rows = [];
  let capped = false;
  const visit = (k, v, segs, depth) => {
    if (rows.length >= ROW_CAP) { capped = true; return; }
    const p = formatPath(segs);
    if (!isContainer(v)) { rows.push({ k, v, p, depth, leaf: true }); return; }
    const kids = entriesOf(v);
    const forced = match && match.anc.has(p);
    const open = over.has(p) ? over.get(p) : forced || (!match && depth < depthOpen);
    rows.push({ k, v, p, depth, open, count: kids.length, arr: Array.isArray(v) });
    if (!open) return;
    const visible = match ? kids.filter(([ck]) => {
      const cp = formatPath(segs.concat(ck));
      return match.hits.has(cp) || match.anc.has(cp);
    }) : kids;
    const lim = shown.get(p) ?? CHUNK;
    for (let i = 0; i < Math.min(lim, visible.length) && !capped; i++) visit(visible[i][0], visible[i][1], segs.concat(visible[i][0]), depth + 1);
    if (visible.length > lim && !capped) rows.push({ more: true, p, depth: depth + 1, left: visible.length - lim });
  };
  visit(null, root, [], 0);
  return { rows, capped };
}

function Hl({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function Leaf({ v, q }) {
  if (v instanceof BigNum) return <span className="jt-n" title="Kept exactly — too large for a JavaScript number"><Hl text={v.raw} q={q} /></span>;
  if (typeof v === "string") {
    const s = v.length > 300 ? `${v.slice(0, 300)}…` : v;
    return <span className="jt-s">"<Hl text={s} q={q} />"</span>;
  }
  if (typeof v === "number") return <span className="jt-n"><Hl text={String(v)} q={q} /></span>;
  if (typeof v === "boolean") return <span className="jt-b"><Hl text={String(v)} q={q} /></span>;
  return <span className="jt-z">null</span>;
}

export const JsonTree = memo(function JsonTree({ value, notify, onQuery }) {
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());
  const [depthOpen, setDepthOpen] = useState(2);
  const [over, setOver] = useState(() => new Map());
  const [shown, setShown] = useState(() => new Map());
  const [sel, setSel] = useState(null);

  useEffect(() => { setShown(new Map()); setSel(null); }, [value]);

  const match = useMemo(() => (dq ? findMatches(value, dq) : null), [value, dq]);
  const { rows, capped } = useMemo(() => buildRows(value, { depthOpen, over, shown, match }), [value, depthOpen, over, shown, match]);

  const toggle = (p, open) => setOver((m) => new Map(m).set(p, open));
  const expandAll = () => { setOver(new Map()); setDepthOpen(Infinity); };
  const collapseAll = () => { setOver(new Map()); setDepthOpen(1); };
  const selValue = (v) => (isContainer(v) ? stringify(v, 2) : v instanceof BigNum ? v.raw : typeof v === "string" ? v : String(v));

  return (
    <div className="jt-wrap">
      <div className="jt-bar">
        <div className="jt-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="jt-q" className="sr-only">Search keys and values</label>
          <input id="jt-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keys and values…" spellCheck={false} autoCapitalize="off" />
        </div>
        <button type="button" className="btn gh sm" onClick={expandAll}><ChevronsUpDown size={15} aria-hidden="true" />Expand all</button>
        <button type="button" className="btn gh sm" onClick={collapseAll}><ChevronsDownUp size={15} aria-hidden="true" />Collapse</button>
      </div>
      <div className="jt-count" aria-live="polite">
        {match && <>
          {match.hits.size ? `${match.hits.size.toLocaleString()} match${match.hits.size === 1 ? "" : "es"}` : "No matches"}
          {match.capped ? " · very large document, searched the first 2,000,000 values" : ""}
        </>}
      </div>
      <div className="jt-path">
        {sel ? (
          <>
            <span className="jt-path-l">Path</span>
            <code>{sel.p}</code>
            <span className="jt-path-a">
              <CopyButton text={sel.p} label="Copy path" className="btn gh sm" notify={notify} toast="Path copied" />
              <CopyButton text={() => selValue(sel.v)} label="Copy value" className="btn gh sm" notify={notify} toast="Value copied" />
              {onQuery && <button type="button" className="btn gh sm" onClick={() => onQuery(sel.p)}><TextSearch size={15} aria-hidden="true" />Query</button>}
            </span>
          </>
        ) : <span className="jt-path-e">Select a row to see its path and copy it or its value.</span>}
      </div>
      <div className="jt" role="list" aria-label="JSON tree">
        {rows.map((r) => (r.more ? (
          <div key={`${r.p}#more`} className="jt-row more" role="listitem" style={{ "--d": r.depth }}>
            <button type="button" className="jt-more" onClick={() => setShown((m) => new Map(m).set(r.p, (m.get(r.p) ?? CHUNK) + CHUNK * 5))}>
              Show more · {r.left.toLocaleString()} hidden
            </button>
          </div>
        ) : (
          <div key={r.p} className={`jt-row${sel?.p === r.p ? " sel" : ""}`} style={{ "--d": r.depth }}
            role="listitem" aria-current={sel?.p === r.p || undefined}>
            {r.leaf ? <span className="jt-car" aria-hidden="true" /> : (
              <button type="button" className="jt-car" onClick={() => toggle(r.p, !r.open)} aria-expanded={r.open} aria-label={`${r.open ? "Collapse" : "Expand"} ${r.k ?? "root"}`}>
                {r.open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="jt-sel" onClick={() => setSel(r)} title={r.p}>
              {r.k !== null && <><span className={`jt-k${typeof r.k === "number" ? " idx" : ""}`}><Hl text={String(r.k)} q={dq} /></span><span className="jt-colon">:&nbsp;</span></>}
              {r.leaf ? <Leaf v={r.v} q={dq} /> : <span className="jt-meta">{r.arr ? `[${r.count}]` : `{${r.count}}`}</span>}
            </button>
          </div>
        )))}
      </div>
      {capped && <div className="hint">Showing the first {ROW_CAP.toLocaleString()} rows — collapse branches or search to see the rest.</div>}
      <div className="hint">Click a row to copy its path or value. Paths work in the Query tab.</div>
    </div>
  );
});

const preview = (v) => {
  const s = v === undefined ? "" : stringify(v, 0);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};
const KIND = {
  added: ["+", "ok", "Added", Plus],
  removed: ["−", "bad", "Removed", Minus],
  changed: ["~", "warn", "Changed", PenLine],
};

export const JsonDiff = memo(function JsonDiff({ a, b, notify }) {
  const result = useMemo(() => diffJSON(a, b), [a, b]);
  const { changes, truncated } = result;
  const counts = changes.reduce((c, x) => ({ ...c, [x.kind]: (c[x.kind] || 0) + 1 }), {});
  const report = () => changes.map((c) => `${KIND[c.kind][0]} ${formatPath(c.path)}${c.kind !== "added" ? `  ${preview(c.from)}` : ""}${c.kind !== "removed" ? `${c.kind === "changed" ? " →" : ""}  ${preview(c.to)}` : ""}`).join("\n");
  if (!changes.length) {
    return (
      <Notice tone="ok" title="Identical" className="jd-same" role="status">
        Both documents have the same structure and values (key order is ignored).
      </Notice>
    );
  }
  return (
    <div>
      <div className="jd-sum">
        <span className="sr-only" role="status">{["added", "removed", "changed"].map((k) => `${counts[k] || 0} ${k}`).join(", ")}</span>
        {["added", "removed", "changed"].map((k) => (
          <StatusBadge key={k} tone={counts[k] ? KIND[k][1] : ""} icon={KIND[k][3]}>{(counts[k] || 0).toLocaleString()} {KIND[k][2].toLowerCase()}</StatusBadge>
        ))}
        {truncated && <StatusBadge>showing first {changes.length.toLocaleString()}</StatusBadge>}
        <CopyButton text={report} label="Copy report" className="btn gh sm jd-copy" notify={notify} toast="Diff copied" />
      </div>
      <ol className="jd-list">
        {changes.slice(0, 500).map((c, i) => {
          const [, tone, word, Icon] = KIND[c.kind];
          return (
            <li className={`jd-row ${tone}`} key={i}>
              <div className="jd-h">
                <span className={`jd-k ${tone}`}><Icon size={12} aria-hidden="true" strokeWidth={2.6} />{word}</span>
                <code>{formatPath(c.path)}</code>
              </div>
              <div className="jd-v">
                {c.kind !== "added" && <del><span className="sr-only">was </span>{preview(c.from)}</del>}
                {c.kind === "changed" && <span className="jd-arrow" aria-hidden="true"> → </span>}
                {c.kind !== "removed" && <ins><span className="sr-only">{c.kind === "changed" ? "now " : ""}</span>{preview(c.to)}</ins>}
              </div>
            </li>
          );
        })}
      </ol>
      {changes.length > 500 && <div className="hint">Showing 500 of {changes.length.toLocaleString()} — use Copy report for all.</div>}
      <div className="hint">Arrays of objects with a unique <code>id</code>, <code>_id</code>, <code>uuid</code> or <code>key</code> are matched by it, so reordering or inserting items isn't reported as every item changing.</div>
    </div>
  );
});
