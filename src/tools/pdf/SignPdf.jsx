import { useState, useRef, useEffect } from "react";
import { FilePick, Results, Shell, readFile } from "./shared.jsx";

const INK = { black: "#111111", blue: "#1d3fbf" };

function trim(canvas) {
  const ctx = canvas.getContext("2d"), { width: w, height: h } = canvas, d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6, out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d").drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}
const toSig = async (canvas) => {
  const t = trim(canvas); if (!t) return null;
  const url = t.toDataURL("image/png");
  return { url, type: "png", bytes: new Uint8Array(await (await fetch(url)).arrayBuffer()) };
};

function DrawPad({ ink, onDone }) {
  const ref = useRef(null), drawing = useRef(false);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) * (ref.current.width / r.width), (e.clientY - r.top) * (ref.current.height / r.height)]; };
  const start = (e) => { drawing.current = true; ref.current.setPointerCapture(e.pointerId); const c = ref.current.getContext("2d"); c.strokeStyle = ink; c.lineWidth = 3; c.lineCap = c.lineJoin = "round"; c.beginPath(); c.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const c = ref.current.getContext("2d"); c.lineTo(...pos(e)); c.stroke(); };
  const end = () => { drawing.current = false; };
  return (
    <div>
      <canvas ref={ref} width={600} height={200} aria-label="Draw your signature"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{ width: "100%", touchAction: "none", background: "#fff", borderRadius: 8, border: "1px solid var(--line)", cursor: "crosshair" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn gh" onClick={() => ref.current.getContext("2d").clearRect(0, 0, 600, 200)}>Clear</button>
        <button type="button" className="btn" onClick={async () => onDone(await toSig(ref.current))}>Use this signature</button>
      </div>
    </div>
  );
}

function TypePad({ ink, onDone }) {
  const [text, setText] = useState("");
  const make = async () => {
    if (!text.trim()) return onDone(null);
    const c = document.createElement("canvas"); c.width = 900; c.height = 220;
    const ctx = c.getContext("2d");
    ctx.font = 'italic 96px "Segoe Script","Brush Script MT","Snell Roundhand","Apple Chancery",cursive';
    ctx.fillStyle = ink; ctx.textBaseline = "middle"; ctx.fillText(text.trim(), 20, 110, 860);
    onDone(await toSig(c));
  };
  return (
    <div>
      <input className="inp" placeholder="Type your name" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} aria-label="Typed signature"
        style={{ fontFamily: '"Segoe Script","Brush Script MT",cursive', fontStyle: "italic", fontSize: 24, height: 56 }} />
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={make}>Use this signature</button>
    </div>
  );
}

export default function SignPdf({ notify, onBack }) {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [prev, setPrev] = useState(null);
  const [tab, setTab] = useState("draw");
  const [ink, setInk] = useState("black");
  const [sig, setSig] = useState(null);
  const [width, setWidth] = useState(25);
  const [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState([]);
  const doc = useRef(null);
  const sigUrls = useRef([]);
  useEffect(() => () => sigUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  /* One pdf.js document per chosen file, reused for every page preview. */
  useEffect(() => {
    if (!bytes) return;
    const p = import("../../lib/pdfRender.js").then((m) => m.pdfSession(bytes));
    doc.current = p;
    return () => { if (doc.current === p) doc.current = null; p.then((d) => d.close(), () => {}); };
  }, [bytes]);

  useEffect(() => {
    const d = doc.current;
    if (!bytes || !d) return;
    let live = true;
    d.then((s) => s.image(pageNum)).then((p) => live && setPrev(p)).catch(() => live && notify("Couldn't preview this PDF."));
    return () => { live = false; };
  }, [bytes, pageNum, notify]);

  const choose = async (f) => { setFile(f); setPrev(null); setBytes(await readFile(f)); setPageNum(1); setPlaces([]); setOut([]); };
  const placeAt = (x, y) => {
    if (!sig) return notify("Create a signature first.");
    setPlaces((p) => [...p, { page: pageNum - 1, x, y, w: width / 100, sig }]);
    setOut([]);
  };
  const place = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    placeAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const upload = async (f) => {
    const type = f.type === "image/png" ? "png" : f.type === "image/jpeg" ? "jpg" : null;
    if (!type) return notify("Use a PNG or JPG image.");
    const b = await readFile(f);
    const url = URL.createObjectURL(f);
    sigUrls.current.push(url);
    setSig({ url, type, bytes: b });
  };

  const apply = async () => {
    if (!places.length) return notify("Click on the page to place your signature.");
    setBusy(true);
    try {
      const { placeImages } = await import("../../lib/pdf.js");
      const res = await placeImages(bytes, places.map((p) => ({ page: p.page, x: p.x, y: p.y, w: p.w, bytes: p.sig.bytes, type: p.sig.type })));
      setOut([{ name: `${file.name.replace(/\.[^.]+$/, "")}-signed.pdf`, blob: new Blob([res], { type: "application/pdf" }) }]);
    } catch (e) { notify(e?.message || "Couldn't sign this PDF."); }
    finally { setBusy(false); }
  };

  const here = places.map((p, i) => ({ ...p, i })).filter((p) => p.page === pageNum - 1);

  return (
    <Shell title="✍️ Sign PDF" desc="Draw, type or upload a signature, then click where it should go." onBack={onBack}>
      <FilePick label="PDF to sign" file={file} onFile={choose} />

      {bytes && (
        <>
          <div className="modes" role="group" aria-label="Signature source">
            {[["draw", "Draw"], ["type", "Type"], ["upload", "Upload image"]].map(([k, l]) =>
              <button key={k} aria-pressed={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab !== "upload" && (
            <div className="pillrow" style={{ marginBottom: 8 }}>
              {Object.keys(INK).map((k) => <button key={k} className="pill" aria-pressed={ink === k} onClick={() => setInk(k)} style={{ borderColor: ink === k ? "var(--pri2)" : undefined }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: INK[k], marginRight: 6 }} />{k}</button>)}
            </div>
          )}
          {tab === "draw" && <DrawPad ink={INK[ink]} onDone={(s) => (s ? (setSig(s), notify("Signature ready — click the page to place it.")) : notify("Draw something first."))} />}
          {tab === "type" && <TypePad ink={INK[ink]} onDone={(s) => (s ? (setSig(s), notify("Signature ready — click the page to place it.")) : notify("Type your name first."))} />}
          {tab === "upload" && <FilePick label="Signature image (PNG with transparent background works best)" accept="image/png,image/jpeg" file={null} onFile={upload} />}

          {sig && <div className="kv" style={{ alignItems: "center", gap: 10, marginTop: 12 }}>
            <span className="k">Current signature</span>
            <img src={sig.url} alt="Your signature" style={{ height: 40, background: "#fff", borderRadius: 6, padding: 4 }} />
          </div>}

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="sw">Signature size ({width}% of page width)</label>
            <input id="sw" type="range" min="8" max="60" value={width} onChange={(e) => setWidth(+e.target.value)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }}>
            <button className="pill" disabled={pageNum <= 1} onClick={() => setPageNum((n) => n - 1)}>← Prev</button>
            <span style={{ fontSize: 13 }}>Page {pageNum} of {prev?.total ?? "…"}</span>
            <button className="pill" disabled={!prev || pageNum >= prev.total} onClick={() => setPageNum((n) => n + 1)}>Next →</button>
            <span className="hint" style={{ margin: "0 0 0 auto" }}>{places.length} placed</span>
          </div>

          {prev && (
            <div style={{ position: "relative", maxWidth: 560, margin: "0 auto", cursor: sig ? "crosshair" : "not-allowed", border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden" }}
              role="button" tabIndex={0} aria-label={`Page ${pageNum}: click to place the signature, or press Enter to place it in the centre`}
              onClick={place} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeAt(0.5, 0.5); } }}>
              <img src={prev.url} alt={`Page ${pageNum}`} draggable={false} style={{ width: "100%", display: "block" }} />
              {here.map((p) => (
                <img key={p.i} src={p.sig.url} alt="" draggable={false}
                  style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, transform: "translate(-50%,-50%)", outline: "1px dashed var(--pri2)", pointerEvents: "none" }} />
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn gh" disabled={!places.length} onClick={() => { setPlaces((p) => p.slice(0, -1)); setOut([]); }}>Undo last</button>
            <button className="btn" style={{ flex: 1 }} disabled={busy || !places.length} onClick={apply}>{busy ? "Signing…" : "Apply signature"}</button>
          </div>
          <Results items={out} />
          <div className="note w" style={{ marginTop: 16 }}>
            <b>Visual signature · </b>this stamps your signature image onto the page, like signing on paper. It is not a certificate-based digital signature,
            so it doesn't prove identity or detect later edits. Pages that are rotated must be set upright first (Rotate PDF).
          </div>
        </>
      )}
    </Shell>
  );
}
