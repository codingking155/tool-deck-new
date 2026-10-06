import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Undo2, LoaderCircle } from "lucide-react";
import { Notice } from "../../components/ui.jsx";
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
        className="pdfs-pad" />
      <div className="pdfs-row">
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
      <input className="inp pdfs-typed" placeholder="Type your name" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} aria-label="Typed signature" />
      <div className="pdfs-row"><button type="button" className="btn" onClick={make}>Use this signature</button></div>
    </div>
  );
}

export default function SignPdf({ notify, onBack, icon }) {
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
    <Shell icon={icon} title="Sign PDF" desc="Draw, type or upload a signature, then click where it should go." onBack={onBack}>
      <FilePick label="PDF to sign" file={file} onFile={choose} />

      {bytes && (
        <>
          <section className="pdfw-sec" aria-labelledby="pdfs-s2">
            <h3 className="pdfw-label" id="pdfs-s2"><span className="pdfs-step" aria-hidden="true">1</span>Create your signature</h3>
            <div className="modes" role="group" aria-label="Signature source">
              {[["draw", "Draw"], ["type", "Type"], ["upload", "Upload image"]].map(([k, l]) =>
                <button type="button" key={k} aria-pressed={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab !== "upload" && (
              <div className="pillrow pdfs-inks" role="group" aria-label="Ink colour">
                {Object.keys(INK).map((k) => <button type="button" key={k} className="pill" aria-pressed={ink === k} onClick={() => setInk(k)}>
                  <span className="pdfs-swatch" style={{ "--ink": INK[k] }} aria-hidden="true" />{k}</button>)}
              </div>
            )}
            {tab === "draw" && <DrawPad ink={INK[ink]} onDone={(s) => (s ? (setSig(s), notify("Signature ready — click the page to place it.")) : notify("Draw something first."))} />}
            {tab === "type" && <TypePad ink={INK[ink]} onDone={(s) => (s ? (setSig(s), notify("Signature ready — click the page to place it.")) : notify("Type your name first."))} />}
            {tab === "upload" && <FilePick label="Signature image (PNG with transparent background works best)" accept="image/png,image/jpeg" file={null} onFile={upload} />}

            {sig && <div className="pdfs-current">
              <span className="pdfw-label">Current signature</span>
              <img src={sig.url} alt="Your signature" className="pdfs-sigprev" />
            </div>}
          </section>

          <section className="pdfw-sec" aria-labelledby="pdfs-s3">
            <h3 className="pdfw-label" id="pdfs-s3"><span className="pdfs-step" aria-hidden="true">2</span>Place it on the page</h3>
            <div className="field">
              <label htmlFor="sw">Signature size ({width}% of page width)</label>
              <input id="sw" type="range" min="8" max="60" value={width} onChange={(e) => setWidth(+e.target.value)} />
            </div>

            <div className="pdfs-nav">
              <button type="button" className="btn gh sm" disabled={pageNum <= 1} onClick={() => setPageNum((n) => n - 1)} aria-label="Previous page"><ChevronLeft aria-hidden="true" />Prev</button>
              <span className="pdfs-pg" aria-live="polite">Page {pageNum} of {prev?.total ?? "…"}</span>
              <button type="button" className="btn gh sm" disabled={!prev || pageNum >= prev.total} onClick={() => setPageNum((n) => n + 1)} aria-label="Next page">Next<ChevronRight aria-hidden="true" /></button>
              <span className="hint pdfs-count" aria-live="polite">{places.length} placed</span>
            </div>
            {!sig && <p className="hint">Create a signature above, then click the page where it should go.</p>}

            {prev ? (
              <div className={`pdfs-stage${sig ? "" : " no-sig"}`}
                role="button" tabIndex={0} aria-label={`Page ${pageNum}: click to place the signature, or press Enter to place it in the centre`}
                onClick={place} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeAt(0.5, 0.5); } }}>
                <img src={prev.url} alt={`Page ${pageNum}`} draggable={false} className="pdfs-page" />
                {here.map((p) => (
                  <img key={p.i} src={p.sig.url} alt="" draggable={false} className="pdfs-placed"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%` }} />
                ))}
              </div>
            ) : <div className="skel pdfs-stageskel" aria-hidden="true" />}
          </section>

          <div className="pdfw-act pdfs-act">
            <button type="button" className="btn gh" disabled={!places.length} onClick={() => { setPlaces((p) => p.slice(0, -1)); setOut([]); }}><Undo2 aria-hidden="true" />Undo last</button>
            <button type="button" className="btn pri" disabled={busy || !places.length} onClick={apply}>
              {busy ? <><LoaderCircle className="spin" aria-hidden="true" />Signing…</> : "Apply signature"}
            </button>
          </div>
          <Results items={out} />
          <Notice tone="w" title="Visual signature" className="pdfw-foot">
            This stamps your signature image onto the page, like signing on paper. It is not a certificate-based digital signature,
            so it doesn't prove identity or detect later edits. Pages that are rotated must be set upright first (Rotate PDF).
          </Notice>
        </>
      )}
    </Shell>
  );
}
