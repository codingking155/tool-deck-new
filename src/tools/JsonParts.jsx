import { memo, useState, useMemo, useDeferredValue, useEffect } from "react";
import { BigNum, isContainer, formatPath, stringify, diffJSON } from "../lib/jsonCore.js";

const CHUNK = 100;
const SEARCH_NODE_CAP = 2000000;
const ROW_CAP = 5000; // "Expand all" on a big document would otherwise mount ~1M rows

async function copyText(text, notify, what) {
  try { await navigator.clipboard.writeText(text); notify(`${what} copied`); }
  catch { notify("Copy failed — select the text and copy manually"); }
}

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

  return (
    <div>
      <div className="jt-bar">
        <label htmlFor="jt-q" className="sr-only">Search keys and values</label>
        <input id="jt-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keys and values…" spellCheck={false} />
        <button className="pill" onClick={expandAll}>Expand all</button>
        <button className="pill" onClick={collapseAll}>Collapse</button>
      </div>
      {match && (
        <div className="hint" style={{ margin: "-4px 0 8px" }}>
          {match.hits.size ? `${match.hits.size.toLocaleString()} match${match.hits.size === 1 ? "" : "es"}` : "No matches"}
          {match.capped ? " · very large document, searched the first 2,000,000 values" : ""}
        </div>
      )}
      {sel && (
        <div className="jt-path">
          <code>{sel.p}</code>
          <button className="pill" onClick={() => copyText(sel.p, notify, "Path")}>Copy path</button>
          <button className="pill" onClick={() => copyText(isContainer(sel.v) ? stringify(sel.v, 2) : sel.v instanceof BigNum ? sel.v.raw : typeof sel.v === "string" ? sel.v : String(sel.v), notify, "Value")}>Copy value</button>
          {onQuery && <button className="pill" onClick={() => onQuery(sel.p)}>Query</button>}
        </div>
      )}
      <div className="jt" role="list" aria-label="JSON tree">
        {rows.map((r) => (r.more ? (
          <div key={`${r.p}#more`} className="jt-row" role="listitem" style={{ paddingLeft: 8 + r.depth * 16 + 22 }}>
            <button className="jt-more" onClick={() => setShown((m) => new Map(m).set(r.p, (m.get(r.p) ?? CHUNK) + CHUNK * 5))}>
              Show more · {r.left.toLocaleString()} hidden
            </button>
          </div>
        ) : (
          <div key={r.p} className={`jt-row${sel?.p === r.p ? " sel" : ""}`} style={{ paddingLeft: 8 + r.depth * 16 }}
            role="listitem" aria-current={sel?.p === r.p || undefined}>
            {r.leaf ? <span className="jt-car" aria-hidden="true" /> : (
              <button className="jt-car" onClick={() => toggle(r.p, !r.open)} aria-expanded={r.open} aria-label={`${r.open ? "Collapse" : "Expand"} ${r.k ?? "root"}`}>{r.open ? "▾" : "▸"}</button>
            )}
            <button className="jt-sel" onClick={() => setSel(r)} title={r.p}>
              {r.k !== null && <><span className={`jt-k${typeof r.k === "number" ? " idx" : ""}`}><Hl text={String(r.k)} q={dq} /></span><span>:&nbsp;</span></>}
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
const KIND = { added: ["+", "chip act", "Added"], removed: ["−", "chip wk", "Removed"], changed: ["~", "chip up", "Changed"] };

export const JsonDiff = memo(function JsonDiff({ a, b, notify }) {
  const result = useMemo(() => diffJSON(a, b), [a, b]);
  const { changes, truncated } = result;
  const counts = changes.reduce((c, x) => ({ ...c, [x.kind]: (c[x.kind] || 0) + 1 }), {});
  const report = () => changes.map((c) => `${KIND[c.kind][0]} ${formatPath(c.path)}${c.kind !== "added" ? `  ${preview(c.from)}` : ""}${c.kind !== "removed" ? `${c.kind === "changed" ? " →" : ""}  ${preview(c.to)}` : ""}`).join("\n");
  if (!changes.length) return <div className="note i" style={{ marginTop: 12 }}><b>Identical · </b>Both documents have the same structure and values (key order is ignored).</div>;
  return (
    <div>
      <div className="jd-sum">
        {["added", "removed", "changed"].map((k) => counts[k] ? <span key={k} className={KIND[k][1]}>{counts[k].toLocaleString()} {KIND[k][2].toLowerCase()}</span> : null)}
        {truncated && <span className="chip done">showing first {changes.length.toLocaleString()}</span>}
        <button className="pill" style={{ marginLeft: "auto" }} onClick={() => copyText(report(), notify, "Diff")}>Copy report</button>
      </div>
      <div className="jd-list">
        {changes.slice(0, 500).map((c, i) => (
          <div className="jd-row" key={i}>
            <span className={KIND[c.kind][1]} style={{ marginRight: 8 }}>{KIND[c.kind][2].toUpperCase()}</span>
            <code>{formatPath(c.path)}</code>
            <div className="jd-v">
              {c.kind !== "added" && <del>{preview(c.from)}</del>}
              {c.kind === "changed" && " → "}
              {c.kind !== "removed" && <ins>{preview(c.to)}</ins>}
            </div>
          </div>
        ))}
      </div>
      {changes.length > 500 && <div className="hint">Showing 500 of {changes.length.toLocaleString()} — use Copy report for all.</div>}
      <div className="hint">Arrays of objects with a unique <code>id</code>, <code>_id</code>, <code>uuid</code> or <code>key</code> are matched by it, so reordering or inserting items isn't reported as every item changing.</div>
    </div>
  );
});
