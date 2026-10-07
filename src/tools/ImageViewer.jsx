import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Maximize, Scan, ChevronLeft, ChevronRight, RotateCw, Grid2x2, Download, Info } from "lucide-react";
import { fmtBytes } from "../lib/imageCore.mjs";
import { fitScale, clampPan, zoomAt, stepZoom, savingPct, wrapIndex } from "../lib/viewerMath.mjs";

const fmtOf = (mime = "", name = "") => (mime.split("/")[1] || name.split(".").pop() || "").replace("svg+xml", "svg").replace("jpeg", "jpg").toUpperCase();

/**
 * Accessible lightbox over the tool's own images. Uses the object URLs the tool already holds
 * (item.src / item.res.url) — it creates none, so there's nothing to revoke here.
 */
export default function ImageViewer({ items, id, onNav, onClose, onSaveResult }) {
  const idx = Math.max(0, items.findIndex((i) => i.id === id));
  const item = items[idx];
  const r = item?.res;
  const hasRes = !!r && r.blob !== item.file;
  const [showRes, setShowRes] = useState(true);
  const res = hasRes && showRes;
  const src = res ? r.url : item.src;
  const w = res ? r.w : item.w, h = res ? r.h : item.h;

  const [view, setView] = useState({ fit: true, scale: 1, pan: { x: 0, y: 0 } });
  const [rot, setRot] = useState(0);
  const [checker, setChecker] = useState(false);
  const [info, setInfo] = useState(true);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const dlg = useRef(null), stage = useRef(null), closeBtn = useRef(null);
  const ptrs = useRef(new Map()), gest = useRef(null);

  const fit = fitScale(w, h, box.w, box.h, rot);
  const scale = view.fit ? fit : view.scale;
  const pan = view.fit ? { x: 0, y: 0 } : view.pan;
  const viewRef = useRef(); viewRef.current = { scale, pan, w, h, box, rot, fit };

  /* reset the view whenever the shown image changes */
  useEffect(() => { setView({ fit: true, scale: 1, pan: { x: 0, y: 0 } }); }, [src]);
  useEffect(() => { setRot(0); }, [id]);

  useLayoutEffect(() => {
    const el = stage.current; if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* focus in, scroll lock; restore both on close */
  useEffect(() => {
    const prev = document.activeElement;
    const ov = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => { document.body.style.overflow = ov; if (prev && prev.focus && document.contains(prev)) prev.focus(); };
  }, []);

  const apply = useCallback((s, p) => {
    const v = viewRef.current;
    setView({ fit: false, scale: s, pan: clampPan(p, v.w, v.h, s, v.box.w, v.box.h, v.rot) });
  }, []);
  const zoomTo = useCallback((next, px = 0, py = 0) => {
    const v = viewRef.current;
    const z = zoomAt(v.scale, v.pan, next, px, py, Math.min(v.fit, 1) / 4);
    apply(z.scale, z.pan);
  }, [apply]);
  const toggleActual = useCallback((px = 0, py = 0) => {
    const v = viewRef.current;
    if (Math.abs(v.scale - 1) < 1e-3 && v.fit < 1) setView((p) => ({ ...p, fit: true }));
    else if (v.fit >= 1 && Math.abs(v.scale - 1) < 1e-3) zoomTo(2, px, py);
    else zoomTo(1, px, py);
  }, [zoomTo]);
  const fitView = () => setView((p) => ({ ...p, fit: true }));
  const nav = useCallback((d) => { if (items.length > 1) onNav(items[wrapIndex(idx + d, items.length)].id); }, [items, idx, onNav]);

  /* keyboard: Esc, ← →, + − 0 1, and Tab trapped inside the dialog */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "Tab") {
        const f = [...dlg.current.querySelectorAll("button:not(:disabled),[href],[tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dlg.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); nav(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nav(1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(stepZoom(viewRef.current.scale, 1)); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomTo(stepZoom(viewRef.current.scale, -1)); }
      else if (e.key === "0") { e.preventDefault(); setView((p) => ({ ...p, fit: true })); }
      else if (e.key === "1") { e.preventDefault(); zoomTo(1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nav, zoomTo, onClose]);

  /* wheel / trackpad zoom around the cursor (non-passive so the page doesn't scroll) */
  useEffect(() => {
    const el = stage.current; if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomTo(viewRef.current.scale * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  /* pointer pan (mouse/touch/pen) + two-finger pinch */
  const rel = (e) => { const b = stage.current.getBoundingClientRect(); return { x: e.clientX - b.left - b.width / 2, y: e.clientY - b.top - b.height / 2 }; };
  const startGesture = () => {
    const v = viewRef.current, pts = [...ptrs.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gest.current = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, scale: v.scale, pan: v.pan };
    } else if (pts.length === 1) gest.current = { pinch: false, p: pts[0], pan: v.pan };
    else gest.current = null;
  };
  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stage.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, rel(e));
    startGesture();
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, rel(e));
    const g = gest.current; if (!g) return;
    const v = viewRef.current;
    if (g.pinch) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(g.scale, g.pan, g.scale * (d / g.d), g.c.x, g.c.y, Math.min(v.fit, 1) / 4);
      apply(z.scale, { x: z.pan.x + c.x - g.c.x, y: z.pan.y + c.y - g.c.y });
      setDragging(true);
    } else {
      const p = ptrs.current.get(e.pointerId);
      const dx = p.x - g.p.x, dy = p.y - g.p.y;
      if (!dragging && Math.hypot(dx, dy) < 3) return;
      if (v.scale <= v.fit + 1e-3) return;   // nothing to pan at fit size
      setDragging(true);
      apply(v.scale, { x: g.pan.x + dx, y: g.pan.y + dy });
    }
  };
  const onUp = (e) => {
    if (!ptrs.current.delete(e.pointerId)) return;
    startGesture();
    if (!ptrs.current.size) setDragging(false);
  };

  const pctLabel = `${Math.round(scale * 100)}%`;
  const saved = hasRes ? savingPct(item.file.size, r.blob.size) : 0;
  const zoomable = scale > fit + 1e-3;
  const dlName = res ? undefined : item.file.name;

  /* portal out of .tpage (its entry transform would trap position:fixed); keep .app + .v3tool scoping */
  const host = document.querySelector(".app") || document.body;
  return createPortal(
    <div className="v3tool imgview-host"><div className="imgview-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="imgview" ref={dlg} role="dialog" aria-modal="true" aria-labelledby="imgview-h" aria-describedby="imgview-help">
        <div className="imgview-top">
          <h2 id="imgview-h" title={item.file.name}><span className="nm">{item.file.name}</span>
            {items.length > 1 && <span className="ct" aria-label={`Image ${idx + 1} of ${items.length}`}>{idx + 1} / {items.length}</span>}</h2>
          <p id="imgview-help" className="sr-only">Arrow keys switch image; plus, minus, 0 for fit and 1 for actual size; drag to pan when zoomed; Escape closes.</p>
          <button ref={closeBtn} type="button" className="btn gh ico" onClick={onClose} title="Close (Esc)" aria-label="Close viewer"><X size={18} aria-hidden="true" /></button>
        </div>

        <div className="imgview-tools" role="toolbar" aria-label="Viewer controls">
          {hasRes && <div className="imgview-seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={!res} className={!res ? "on" : ""} onClick={() => setShowRes(false)}>Original</button>
            <button type="button" aria-pressed={res} className={res ? "on" : ""} onClick={() => setShowRes(true)}>Result</button>
          </div>}
          <div className="grp">
            <button type="button" className="btn gh ico" onClick={() => zoomTo(stepZoom(scale, -1))} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={17} aria-hidden="true" /></button>
            <span className="pc" aria-live="polite" aria-label={`Zoom ${pctLabel}`}>{pctLabel}</span>
            <button type="button" className="btn gh ico" onClick={() => zoomTo(stepZoom(scale, 1))} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={17} aria-hidden="true" /></button>
            <button type="button" className="btn gh ico" onClick={fitView} aria-pressed={view.fit} title="Fit to screen (0)" aria-label="Fit to screen"><Maximize size={17} aria-hidden="true" /></button>
            <button type="button" className="btn gh ico" onClick={() => zoomTo(1)} aria-pressed={!view.fit && Math.abs(scale - 1) < 1e-3} title="Actual pixels, 100% (1)" aria-label="Actual size 100%"><Scan size={17} aria-hidden="true" /></button>
          </div>
          <div className="grp">
            <button type="button" className="btn gh ico" onClick={() => { setRot((x) => (x + 90) % 360); fitView(); }} title="Rotate view 90° (file unchanged)" aria-label="Rotate view 90 degrees"><RotateCw size={17} aria-hidden="true" /></button>
            <button type="button" className="btn gh ico" onClick={() => setChecker((c) => !c)} aria-pressed={checker} title="Transparency checkerboard" aria-label="Checkerboard background"><Grid2x2 size={17} aria-hidden="true" /></button>
            <button type="button" className="btn gh ico" onClick={() => setInfo((c) => !c)} aria-pressed={info} title="Image info" aria-label="Image info"><Info size={17} aria-hidden="true" /></button>
            {res
              ? <button type="button" className="btn gh ico" onClick={() => onSaveResult(item)} title="Download result" aria-label="Download result"><Download size={17} aria-hidden="true" /></button>
              : <a className="btn gh ico" href={item.src} download={dlName} title="Download original" aria-label="Download original"><Download size={17} aria-hidden="true" /></a>}
          </div>
        </div>

        <div className="imgview-body">
          <div ref={stage} className={`imgview-stage${checker ? " chk" : ""}${zoomable ? " pan" : ""}${dragging ? " drag" : ""}`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onDoubleClick={(e) => { const p = rel(e); toggleActual(p.x, p.y); }}>
            {box.w > 0 && <img src={src} alt={`${res ? "Result" : "Original"}: ${item.file.name}`} draggable={false}
              style={{ width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2,
                transform: `translate(${pan.x}px,${pan.y}px) rotate(${rot}deg) scale(${scale})` }} />}
            {items.length > 1 && <>
              <button type="button" className="btn gh ico imgview-nav prev" onClick={() => nav(-1)} onPointerDown={(e) => e.stopPropagation()} title="Previous (←)" aria-label="Previous image"><ChevronLeft size={22} aria-hidden="true" /></button>
              <button type="button" className="btn gh ico imgview-nav next" onClick={() => nav(1)} onPointerDown={(e) => e.stopPropagation()} title="Next (→)" aria-label="Next image"><ChevronRight size={22} aria-hidden="true" /></button>
            </>}
          </div>
          {info && <dl className="imgview-info">
            <div><dt>Name</dt><dd title={item.file.name}>{item.file.name}</dd></div>
            <div><dt>Type</dt><dd>{fmtOf(item.file.type, item.file.name) || "—"}{hasRes && fmtOf(r.mime) !== fmtOf(item.file.type, item.file.name) ? ` → ${fmtOf(r.mime)}` : ""}</dd></div>
            <div><dt>Dimensions</dt><dd>{item.w}×{item.h}{hasRes && (r.w !== item.w || r.h !== item.h) ? ` → ${r.w}×${r.h}` : ""}</dd></div>
            <div><dt>File size</dt><dd>{fmtBytes(item.file.size)}</dd></div>
            {hasRes && <div><dt>Result size</dt><dd>{fmtBytes(r.blob.size)}</dd></div>}
            {hasRes && <div><dt>{saved >= 0 ? "Saving" : "Growth"}</dt><dd className={saved >= 0 ? "good" : "bad"}>{saved >= 0 ? `↓ ${saved}%` : `↑ ${-saved}%`}</dd></div>}
          </dl>}
        </div>
      </div>
    </div></div>, host);
}
