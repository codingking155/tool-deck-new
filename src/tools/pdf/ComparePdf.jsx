import { useState, useRef, useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { Notice } from "../../components/ui.jsx";
import { FilePick, Shell, Progress, fraction, readFile } from "./shared.jsx";
import { diffWords, tokenize, diffStats, pixelDiff } from "../../lib/compare.js";

const MAX_VISUAL_PAGES = 40;

function Overlay({ diff }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !diff) return;
    c.width = diff.width; c.height = diff.height;
    c.getContext("2d")?.putImageData(new ImageData(diff.overlay, diff.width, diff.height), 0, 0);
  }, [diff]);
  return <canvas ref={ref} className="pdfc-img" aria-label="Differences highlighted" role="img" />;
}

export default function ComparePdf({ notify, onBack, icon }) {
  const [a, setA] = useState(null), [b, setB] = useState(null);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState("text");
  const [imgs, setImgs] = useState(null);
  /* Both documents stay open (one pdf.js copy each) for the visual view; closed on re-run / unmount. */
  const docs = useRef(null);
  const mounted = useRef(true);
  const closeDocs = () => { const d = docs.current; docs.current = null; d?.a.close(); d?.b.close(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; closeDocs(); }; }, []);

  const run = async () => {
    if (!a || !b) return notify("Choose both PDFs.");
    closeDocs();
    setRes(null); setImgs(null); setSel(0); setBusy("Reading text…");
    let sa, sb;
    try {
      const r = await import("../../lib/pdfRender.js");
      sa = await r.pdfSession(await readFile(a));
      sb = await r.pdfSession(await readFile(b));
      const [ta, tb] = [await sa.text(), await sb.text()];
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
          const [ia, ib] = [await sa.rgba(i + 1), await sb.rgba(i + 1)];
          const d = pixelDiff(ia, ib);
          pages[i].pct = d.percent; pages[i].diff = d;
        }
      }
      if (!mounted.current) throw new Error("closed");
      docs.current = { a: sa, b: sb };
      setRes({ pages, pagesA: ta.length, pagesB: tb.length, visualCapped: n > vis });
    } catch (e) {
      sa?.close(); sb?.close();
      if (mounted.current) notify(`Compare failed: ${e?.message || "unknown error"}`);
    } finally { if (mounted.current) setBusy(""); }
  };

  useEffect(() => {
    const d = docs.current;
    if (!res || view !== "visual" || !d) return;
    let live = true;
    setImgs(null);
    (async () => {
      const p = res.pages[sel];
      const ia = sel < res.pagesA ? await d.a.image(sel + 1, 420) : null;
      const ib = sel < res.pagesB ? await d.b.image(sel + 1, 420) : null;
      if (live) setImgs({ ia, ib, p });
    })().catch(() => live && setImgs({ err: true }));
    return () => { live = false; };
  }, [res, sel, view]);

  const changedPages = res ? res.pages.filter((p) => p.changed || (p.pct ?? 0) > 0.05 || p.onlyIn).length : 0;
  const tot = res ? res.pages.reduce((s, p) => ({ added: s.added + p.added, removed: s.removed + p.removed }), { added: 0, removed: 0 }) : null;
  const page = res?.pages[sel];

  return (
    <Shell icon={icon} wide title="Compare PDF" desc="See what changed between two versions — text differences and a visual overlay." onBack={onBack}>
      <div className="pdfc-pair">
        <FilePick label="Original (A)" file={a} onFile={(f) => { setA(f); setRes(null); closeDocs(); }} />
        <FilePick label="Revised (B)" file={b} onFile={(f) => { setB(f); setRes(null); closeDocs(); }} />
      </div>
      <div className="pdfw-act">
        <button className="btn pri" disabled={!a || !b || !!busy} onClick={run}>
          {busy ? <><LoaderCircle className="spin" aria-hidden="true" />Working…</> : "Compare"}
        </button>
        {!busy && (!a || !b) && <p className="hint">Choose both versions to compare them. Both stay on this device.</p>}
        {busy && <Progress label={busy} value={fraction(busy)} />}
      </div>

      {res && (
        <section className="pdfw-out" aria-label="Comparison">
          <Notice tone="i" role="status" title={changedPages === 0 ? "No differences found" : `${changedPages} of ${res.pages.length} page${res.pages.length > 1 ? "s" : ""} differ`}>
            <span className="pdfc-add">+{tot.added} words added</span>, <span className="pdfc-del">−{tot.removed} removed</span>
            {res.pagesA !== res.pagesB && ` · A has ${res.pagesA} pages, B has ${res.pagesB}`}
            {res.visualCapped && ` · visual comparison covers the first ${MAX_VISUAL_PAGES} pages`}
          </Notice>

          <div className="pdfw-sechead"><h3 className="pdfw-label" id="pdfc-pages">Pages</h3><span className="hint pdfc-key"><i className="pdfc-dot" aria-hidden="true" /> changed</span></div>
          <div className="pdfc-pages" role="group" aria-labelledby="pdfc-pages">
            {res.pages.map((p, i) => {
              const diff = p.changed || (p.pct ?? 0) > 0.05 || p.onlyIn;
              return <button key={i} type="button" className={`pill pdfc-page${diff ? " is-diff" : ""}`} aria-pressed={sel === i} onClick={() => setSel(i)}
                aria-label={`Page ${i + 1}, ${p.onlyIn ? `only in ${p.onlyIn}` : diff ? "changed" : "no changes"}${p.pct != null ? `, ${p.pct.toFixed(1)}% pixels differ` : ""}`}>
                {diff && <i className="pdfc-dot" aria-hidden="true" />}{i + 1}{p.pct != null ? ` · ${p.pct.toFixed(1)}%` : ""}</button>;
            })}
          </div>

          <div className="modes pdfc-view" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "text"} className={view === "text" ? "on" : ""} onClick={() => setView("text")}>Text changes</button>
            <button type="button" aria-pressed={view === "visual"} className={view === "visual" ? "on" : ""} onClick={() => setView("visual")}>Visual overlay</button>
          </div>

          {view === "text" && page && (
            <div className="pdfc-text" aria-label={`Text changes on page ${sel + 1}`} role="region">
              {page.onlyIn && <Notice tone="w">This page exists only in {page.onlyIn}.</Notice>}
              {page.ops.length === 0 ? <span className="pdfc-none">No selectable text on this page (scanned or image-only) — use the visual overlay.</span> :
                page.ops.map((o, i) => o.t === "eq" ? <span key={i}>{o.w} </span>
                  : o.t === "add" ? <ins key={i} className="pdfc-ins">{o.w} </ins>
                  : <del key={i} className="pdfc-rm">{o.w} </del>)}
            </div>
          )}

          {view === "visual" && (
            !imgs ? <p className="hint" role="status">Rendering page {sel + 1}…</p>
            : imgs.err ? <Notice tone="w" role="status">Couldn't render page {sel + 1} for the visual overlay. Try another page or run Compare again.</Notice> : (
              <div className="pdfc-vis">
                {[["A", imgs.ia && <img src={imgs.ia.url} alt={`Page ${sel + 1} of the original`} className="pdfc-img" />],
                  ["B", imgs.ib && <img src={imgs.ib.url} alt={`Page ${sel + 1} of the revision`} className="pdfc-img" />],
                  ["Differences", imgs.p.diff ? <Overlay diff={imgs.p.diff} /> : null]].map(([t, el]) => (
                  <figure key={t} className="pdfc-fig"><figcaption>{t}</figcaption>{el || <p className="hint">Not available for this page.</p>}</figure>
                ))}
              </div>
            )
          )}
        </section>
      )}
    </Shell>
  );
}
