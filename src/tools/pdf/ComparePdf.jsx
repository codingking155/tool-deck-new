import { useState, useRef, useEffect } from "react";
import { FilePick, Shell, readFile } from "./shared.jsx";
import { diffWords, tokenize, diffStats, pixelDiff } from "../../lib/compare.js";

const MAX_VISUAL_PAGES = 40;

function Overlay({ diff }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !diff) return;
    c.width = diff.width; c.height = diff.height;
    c.getContext("2d").putImageData(new ImageData(diff.overlay, diff.width, diff.height), 0, 0);
  }, [diff]);
  return <canvas ref={ref} style={{ width: "100%", display: "block", borderRadius: 6, border: "1px solid var(--line)" }} />;
}

export default function ComparePdf({ notify, onBack }) {
  const [a, setA] = useState(null), [b, setB] = useState(null);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState("text");
  const [imgs, setImgs] = useState(null);
  const bytes = useRef({});

  const run = async () => {
    if (!a || !b) return notify("Choose both PDFs.");
    setRes(null); setImgs(null); setSel(0); setBusy("Reading text…");
    try {
      const r = await import("../../lib/pdfRender.js");
      const [ba, bb] = [await readFile(a), await readFile(b)];
      bytes.current = { a: ba, b: bb };
      const [ta, tb] = [await r.pdfTextPages(ba), await r.pdfTextPages(bb)];
      const n = Math.max(ta.length, tb.length);
      const pages = [];
      for (let i = 0; i < n; i++) {
        const ops = diffWords(tokenize(ta[i] ?? ""), tokenize(tb[i] ?? ""));
        pages.push({ ops, ...diffStats(ops), onlyIn: i >= ta.length ? "B" : i >= tb.length ? "A" : null, pct: null, diff: null });
      }
      const vis = Math.min(n, MAX_VISUAL_PAGES);
      for (let i = 0; i < vis; i++) {
        setBusy(`Comparing page ${i + 1} of ${vis}…`);
        if (i < ta.length && i < tb.length) {
          const [ia, ib] = [await r.pdfPageRgba(ba, i + 1), await r.pdfPageRgba(bb, i + 1)];
          const d = pixelDiff(ia, ib);
          pages[i].pct = d.percent; pages[i].diff = d;
        }
      }
      setRes({ pages, pagesA: ta.length, pagesB: tb.length, visualCapped: n > vis });
    } catch (e) { notify(`Compare failed: ${e?.message || "unknown error"}`); }
    finally { setBusy(""); }
  };

  useEffect(() => {
    if (!res || view !== "visual" || !bytes.current.a) return;
    let live = true;
    setImgs(null);
    import("../../lib/pdfRender.js").then(async (r) => {
      const p = res.pages[sel];
      const ia = sel < res.pagesA ? await r.pdfPageImage(bytes.current.a, sel + 1, 420) : null;
      const ib = sel < res.pagesB ? await r.pdfPageImage(bytes.current.b, sel + 1, 420) : null;
      if (live) setImgs({ ia, ib, p });
    });
    return () => { live = false; };
  }, [res, sel, view]);

  const changedPages = res ? res.pages.filter((p) => p.changed || (p.pct ?? 0) > 0.05 || p.onlyIn).length : 0;
  const tot = res ? res.pages.reduce((s, p) => ({ added: s.added + p.added, removed: s.removed + p.removed }), { added: 0, removed: 0 }) : null;
  const page = res?.pages[sel];

  return (
    <Shell title="🆚 Compare PDF" desc="See what changed between two versions — text differences and a visual overlay." onBack={onBack}>
      <div className="two">
        <FilePick label="Original (A)" file={a} onFile={(f) => { setA(f); setRes(null); }} />
        <FilePick label="Revised (B)" file={b} onFile={(f) => { setB(f); setRes(null); }} />
      </div>
      <button className="btn" style={{ width: "100%" }} disabled={!a || !b || !!busy} onClick={run}>{busy || "Compare"}</button>

      {res && (
        <div style={{ marginTop: 16 }}>
          <div className="note i">
            <b>{changedPages === 0 ? "No differences found" : `${changedPages} of ${res.pages.length} page${res.pages.length > 1 ? "s" : ""} differ`} · </b>
            <span style={{ color: "var(--good)" }}>+{tot.added} words added</span>, <span style={{ color: "var(--bad)" }}>−{tot.removed} removed</span>
            {res.pagesA !== res.pagesB && ` · A has ${res.pagesA} pages, B has ${res.pagesB}`}
            {res.visualCapped && ` · visual comparison covers the first ${MAX_VISUAL_PAGES} pages`}
          </div>

          <div className="pillrow" style={{ marginTop: 12 }}>
            {res.pages.map((p, i) => {
              const diff = p.changed || (p.pct ?? 0) > 0.05 || p.onlyIn;
              return <button key={i} className="pill" aria-pressed={sel === i} onClick={() => setSel(i)}
                style={{ borderColor: sel === i ? "var(--pri2)" : undefined, color: diff ? "var(--warn)" : undefined }}>
                {i + 1}{p.pct != null ? ` · ${p.pct.toFixed(1)}%` : ""}</button>;
            })}
          </div>

          <div className="modes" role="tablist" style={{ marginTop: 12 }}>
            <button role="tab" aria-selected={view === "text"} className={view === "text" ? "on" : ""} onClick={() => setView("text")}>Text changes</button>
            <button role="tab" aria-selected={view === "visual"} className={view === "visual" ? "on" : ""} onClick={() => setView("visual")}>Visual overlay</button>
          </div>

          {view === "text" && page && (
            <div className="panel" style={{ padding: 14, lineHeight: 1.8, fontSize: 14 }}>
              {page.onlyIn && <div className="note w" style={{ marginBottom: 8 }}>This page exists only in {page.onlyIn}.</div>}
              {page.ops.length === 0 ? <span style={{ color: "var(--tx3)" }}>No selectable text on this page (scanned or image-only) — use the visual overlay.</span> :
                page.ops.map((o, i) => o.t === "eq" ? <span key={i}>{o.w} </span>
                  : o.t === "add" ? <span key={i} style={{ background: "rgba(91,214,138,.18)", color: "var(--good)", borderRadius: 3 }}>{o.w} </span>
                  : <span key={i} style={{ background: "rgba(255,90,90,.15)", color: "var(--bad)", textDecoration: "line-through", borderRadius: 3 }}>{o.w} </span>)}
            </div>
          )}

          {view === "visual" && (
            !imgs ? <div className="hint" style={{ marginTop: 12 }}>Rendering page {sel + 1}…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 4 }}>
                {[["A", imgs.ia && <img src={imgs.ia.url} alt="" style={{ width: "100%", borderRadius: 6, border: "1px solid var(--line)" }} />],
                  ["B", imgs.ib && <img src={imgs.ib.url} alt="" style={{ width: "100%", borderRadius: 6, border: "1px solid var(--line)" }} />],
                  ["Differences", imgs.p.diff ? <Overlay diff={imgs.p.diff} /> : null]].map(([t, el]) => (
                  <div key={t}><div className="hint" style={{ marginBottom: 4 }}>{t}</div>{el || <div className="hint">Not available for this page.</div>}</div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </Shell>
  );
}
