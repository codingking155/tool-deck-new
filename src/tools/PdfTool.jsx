import { useState, useRef, useMemo, useEffect, useId, lazy, Suspense } from "react";
import {
  Merge, Scissors, FileMinus, FileOutput, ListOrdered, RotateCw, Minimize2, Wrench, ScanText, Images, ImageDown, FileText,
  Droplets, Hash, Crop, Signature, GitCompareArrows, Lock, LockOpen, Search, ChevronRight, ChevronUp, ChevronDown, X, FileUp,
  Download, FolderInput, Gauge, Repeat, PencilLine, ShieldCheck, Check, LoaderCircle, RotateCcw, Layers,
} from "lucide-react";
import { Notice, EmptyState } from "../components/ui.jsx";
import { SubHead, LocalNote, Progress, kb } from "./pdf/shared.jsx";
const SignPdf = lazy(() => import("./pdf/SignPdf.jsx"));
const ComparePdf = lazy(() => import("./pdf/ComparePdf.jsx"));
const OcrPdf = lazy(() => import("./pdf/OcrPdf.jsx"));
const qpdfOps = async () => {
  const [ops, wasm, script] = await Promise.all([import("../lib/qpdf.js"), import("@jspawn/qpdf-wasm/qpdf.wasm?url"), import("@jspawn/qpdf-wasm/qpdf.js?url")]);
  return { ...ops, rt: { factory: await ops.browserQpdfFactory(script.default), env: { locateFile: (f) => (f.endsWith(".wasm") ? wasm.default : f) } } };
};
const pdfOps = () => import("../lib/pdf.js");
import { readParams, writeParams } from "../hooks/index.js";
import { parseRanges } from "../lib/pdfRanges.js";
import "./css/pdf.css";

const PAGES = { key: "pages", label: "Pages (e.g. 1-3, 5, 8-)", type: "text", ph: "1-3, 5" };
const base = (f) => f.name.replace(/\.[^.]+$/, "");
const pdf = (bytes, name) => ({ name, blob: new Blob([bytes], { type: "application/pdf" }) });

/* "1-3,5" <-> clicked pages. Organize keeps click order; others collapse to sorted ranges. */
function specFrom(indices, ordered) {
  if (ordered) return indices.map((i) => i + 1).join(",");
  const a = [...new Set(indices)].sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i;
    while (a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i] + 1}-${a[j] + 1}` : `${a[i] + 1}`);
    i = j;
  }
  return out.join(", ");
}
function safeIndices(spec, total) { try { return spec.trim() ? parseRanges(spec, total) : []; } catch { return []; } }

const GROUPS = [
  { name: "Organize", ico: FolderInput }, { name: "Optimize", ico: Gauge }, { name: "Convert", ico: Repeat },
  { name: "Edit", ico: PencilLine }, { name: "Security", ico: ShieldCheck },
];

/* run(files, opts, progress) -> [{ name, blob }]; files are [{ name, bytes }]
   name: card + sub-tool title · short: one-line card purpose · desc: sub-tool hint · action: primary button label */
const TOOLS = [
  { id: "merge", g: 0, ico: Merge, name: "Merge PDF", short: "Combine PDFs into one, in your order.", desc: "Combine PDFs in the order you want.",
    multi: true, min: 2, action: "Merge PDF", order: "Merged top to bottom — use the arrows to change the order.",
    run: async (fs) => [pdf(await (await pdfOps()).mergePdfs(fs.map((f) => f.bytes)), "merged.pdf")] },
  { id: "split", pick: "spec", g: 0, ico: Scissors, name: "Split PDF", short: "One file per page, or per range.", desc: "One file per page, or per range group.", action: "Split PDF",
    opts: [{ key: "spec", label: "Ranges, comma-separated groups (blank = every page)", type: "text", ph: "1-3, 4-6" }],
    run: async ([f], o) => (await (await pdfOps()).splitPdf(f.bytes, o.spec || "")).map((b, i) => pdf(b, `${base(f)}-part${i + 1}.pdf`)) },
  { id: "remove", pick: "pages", g: 0, ico: FileMinus, name: "Remove pages", short: "Delete the pages you don't need.", desc: "Delete the pages you don't need.", action: "Remove pages", opts: [PAGES],
    run: async ([f], o) => [pdf(await (await pdfOps()).removePages(f.bytes, o.pages || ""), `${base(f)}-trimmed.pdf`)] },
  { id: "extract", pick: "pages", g: 0, ico: FileOutput, name: "Extract pages", short: "Pull chosen pages into a new PDF.", desc: "Pull selected pages into a new PDF.", action: "Extract pages", opts: [PAGES],
    run: async ([f], o) => [pdf(await (await pdfOps()).extractPages(f.bytes, o.pages || ""), `${base(f)}-extract.pdf`)] },
  { id: "organize", pick: "pages", g: 0, ico: ListOrdered, name: "Organize PDF", short: "Reorder or duplicate pages.", desc: "Reorder or duplicate pages — write the new order.", action: "Reorder pages",
    opts: [{ key: "pages", label: "New page order (e.g. 3,1,2 or 5-1)", type: "text", ph: "3,1,2" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).extractPages(f.bytes, o.pages || ""), `${base(f)}-organized.pdf`)] },
  { id: "rotate", pick: "pages", g: 0, ico: RotateCw, name: "Rotate PDF", short: "Turn all pages, or just some.", desc: "Rotate all pages, or just some.", action: "Rotate pages",
    opts: [{ key: "deg", label: "Rotate", type: "select", options: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° counter-clockwise"]], def: "90" },
      { key: "pages", label: "Pages (blank = all)", type: "text", ph: "2-4" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).rotatePdf(f.bytes, Number(o.deg) || 90, o.pages || ""), `${base(f)}-rotated.pdf`)] },

  { id: "compress", heavy: true, g: 1, ico: Minimize2, name: "Compress PDF", short: "Smaller file by re-rendering pages.", desc: "Smaller file by re-rendering pages as images (text becomes non-selectable).", action: "Compress PDF",
    opts: [{ key: "level", label: "Compression", type: "select", options: [["low", "Low — best quality"], ["medium", "Medium"], ["high", "High — smallest"]], def: "medium" }],
    run: async ([f], o, prog) => {
      const { compressPdf } = await import("../lib/pdfRender.js");
      const out = await compressPdf(f.bytes, { level: o.level || "medium", onProgress: prog });
      if (out.length >= f.bytes.length) throw new Error("Already well-optimised — re-rendering would not make this file smaller.");
      return [pdf(out, `${base(f)}-compressed.pdf`)];
    } },
  { id: "repair", g: 1, ico: Wrench, name: "Repair PDF", short: "Rebuild a damaged PDF.", desc: "Rebuild a damaged PDF's structure and recover its pages.", action: "Repair PDF",
    run: async ([f]) => [pdf(await (await pdfOps()).rebuildPdf(f.bytes), `${base(f)}-repaired.pdf`)] },
  { id: "ocr", g: 1, ico: ScanText, name: "OCR PDF", short: "Make scanned PDFs searchable.", desc: "Make scanned PDFs searchable and export the text.", Custom: OcrPdf },

  { id: "jpg2pdf", g: 2, ico: Images, name: "JPG / PNG to PDF", short: "Images into a PDF, one per page.", desc: "Turn images into a PDF, one per page.", multi: true, accept: "image/jpeg,image/png",
    action: "Convert to PDF", order: "One page per image, top to bottom — use the arrows to change the order.",
    opts: [{ key: "fit", label: "Page size", type: "select", options: [["image", "Same as image"], ["a4", "A4 (fit)"]], def: "image" },
      { key: "margin", label: "Margin (pt)", type: "number", def: 0 }],
    run: async (fs, o) => [pdf(await (await pdfOps()).imagesToPdf(fs.map((f) => ({ bytes: f.bytes, type: /png$/i.test(f.type) ? "png" : "jpg" })), { fit: o.fit || "image", margin: Number(o.margin) || 0 }), "images.pdf")] },
  { id: "pdf2jpg", heavy: true, g: 2, ico: ImageDown, name: "PDF to JPG", short: "Every page as a high-quality JPG.", desc: "Every page as a high-quality JPG.", action: "Convert PDF to JPG",
    opts: [{ key: "scale", label: "Resolution", type: "select", options: [["1.5", "Standard"], ["2", "High"], ["3", "Very high"]], def: "2" }],
    run: async ([f], o, prog) => {
      const { pdfToJpegs } = await import("../lib/pdfRender.js");
      const imgs = await pdfToJpegs(f.bytes, { scale: Number(o.scale) || 2, onProgress: prog });
      return imgs.map((b, i) => ({ name: `${base(f)}-page${i + 1}.jpg`, blob: new Blob([b], { type: "image/jpeg" }) }));
    } },
  { id: "pdf2word", heavy: true, g: 2, ico: FileText, name: "PDF to Word", short: "Editable DOCX of the text.", desc: "Editable DOCX of the text (layout, images and tables are not kept).", action: "Convert to Word",
    run: async ([f], o, prog) => {
      const { pdfToDocx } = await import("../lib/pdfRender.js");
      const { blob } = await pdfToDocx(f.bytes, { onProgress: prog });
      return [{ name: `${base(f)}.docx`, blob }];
    } },

  { id: "watermark", g: 3, ico: Droplets, name: "Watermark", short: "Diagonal text on every page.", desc: "Diagonal text watermark on every page.", action: "Add watermark",
    opts: [{ key: "text", label: "Watermark text", type: "text", ph: "CONFIDENTIAL" },
      { key: "opacity", label: "Opacity", type: "select", options: [["0.15", "Light"], ["0.25", "Medium"], ["0.5", "Strong"]], def: "0.25" },
      { key: "font", label: "Font file for non-Latin text (optional: .ttf, .otf, .woff)", type: "file", accept: ".ttf,.otf,.woff" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).addWatermark(f.bytes, { text: o.text, opacity: Number(o.opacity) || 0.25,
      fontBytes: o.font ? new Uint8Array(await o.font.arrayBuffer()) : null }), `${base(f)}-watermarked.pdf`)] },
  { id: "numbers", g: 3, ico: Hash, name: "Add page numbers", short: "Number every page, in any corner.", desc: "Stamp page numbers on every page.", action: "Add page numbers",
    opts: [{ key: "position", label: "Position", type: "select", options: [["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]], def: "bottom-center" },
      { key: "start", label: "Start at", type: "number", def: 1 }],
    run: async ([f], o) => [pdf(await (await pdfOps()).addPageNumbers(f.bytes, { position: o.position || "bottom-center", start: Number(o.start) || 1 }), `${base(f)}-numbered.pdf`)] },
  { id: "crop", g: 3, ico: Crop, name: "Crop PDF", short: "Trim margins off every page.", desc: "Trim margins off every page (points; 72 pt = 1 inch).", action: "Crop PDF",
    opts: ["top", "right", "bottom", "left"].map((k) => ({ key: k, label: `${k[0].toUpperCase() + k.slice(1)} (pt)`, type: "number", def: 0 })),
    run: async ([f], o) => [pdf(await (await pdfOps()).cropPdf(f.bytes, { top: +o.top || 0, right: +o.right || 0, bottom: +o.bottom || 0, left: +o.left || 0 }), `${base(f)}-cropped.pdf`)] },
  { id: "sign", g: 3, ico: Signature, name: "Sign PDF", short: "Draw, type or upload a signature.", desc: "Draw, type or upload a signature and place it on any page.", Custom: SignPdf },
  { id: "compare", g: 3, ico: GitCompareArrows, name: "Compare PDF", short: "See what changed between versions.", desc: "Spot text and visual differences between two versions.", Custom: ComparePdf },

  { id: "protect", noCount: true, g: 4, ico: Lock, name: "Protect PDF", short: "Encrypt with a password (AES-256).", desc: "Encrypt with a password (AES-256) and optionally restrict printing, copying or editing.", action: "Protect PDF",
    opts: [{ key: "password", label: "Password to open the PDF", type: "password" },
      { key: "print", label: "Printing", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" },
      { key: "copy", label: "Copying text and images", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" },
      { key: "modify", label: "Editing", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" }],
    run: async ([f], o) => {
      const q = await qpdfOps();
      return [pdf(await q.protectPdf(f.bytes, { userPassword: o.password || "", allowPrint: (o.print || "y") === "y", allowCopy: (o.copy || "y") === "y", allowModify: (o.modify || "y") === "y" }, q.rt), `${base(f)}-protected.pdf`)];
    } },
  { id: "unlock", noCount: true, g: 4, ico: LockOpen, name: "Unlock PDF", short: "Lift restrictions or a known password.", desc: "Remove edit/print/copy restrictions, or the password if you know it.", action: "Unlock PDF",
    opts: [{ key: "password", label: "Password (only if the PDF needs one to open)", type: "password" }],
    run: async ([f], o) => { const q = await qpdfOps(); return [pdf(await q.unlockPdf(f.bytes, o.password || "", q.rt), `${base(f)}-unlocked.pdf`)]; } },
];

/* ToolDeck tool id -> the same tool in Sheaf PDF Studio (/tool/sheaf, public/sheaf). */
const SHEAF = { merge: "merge", split: "split", remove: "remove", extract: "extract", organize: "organize", compress: "compress",
  jpg2pdf: "img2pdf", pdf2jpg: "pdf2jpg", rotate: "rotate", numbers: "pagenum", watermark: "watermark", crop: "crop",
  protect: "protect", unlock: "unlock", sign: "sign" };

const NOT_AVAILABLE = [
  "Word / PowerPoint / Excel / HTML to PDF", "PDF to PowerPoint / Excel / PDF/A",
  "Redact PDF", "Edit PDF text",
];

/* Calm, specific recovery advice for the errors the PDF libs throw. `go` opens a sibling tool. */
function recovery(msg, toolId) {
  if (/needs a password/i.test(msg)) return { tone: "w", hint: "Type the password in the Password field above, then try again." };
  if (/password is incorrect/i.test(msg)) return { tone: "w", hint: "Passwords are case-sensitive — check Caps Lock, spaces and accented letters." };
  if (/encrypted/i.test(msg)) return { tone: "w", hint: "Remove the password with Unlock PDF, then come back with the unlocked file.", go: "unlock" };
  if (/rotated/i.test(msg)) return { tone: "w", go: "rotate" };
  if (/already well-optimised/i.test(msg)) return { tone: "i", hint: "Your original is already about as small as this method can make it — nothing was lost." };
  if (/couldn't read|invalid|parse|corrupt|damaged|header|xref/i.test(msg)) return { tone: "e", hint: "The file may be damaged or not really a PDF.", go: toolId !== "repair" ? "repair" : null };
  if (/unsupported file type/i.test(msg)) return { tone: "w", hint: "Choose a file of the type this tool accepts and try again." };
  return { tone: "e", hint: "Check the settings above and try again. Your files never left this device." };
}

function download(item) {
  const a = document.createElement("a");
  a.href = item.url; a.download = item.name;
  document.body.appendChild(a); a.click(); a.remove();
}

function Field({ f, value, onChange }) {
  const id = useId();
  const v = value ?? f.def ?? "";
  const wide = f.type === "text" || f.type === "password" || f.type === "file";
  return (
    <div className={`field pdfw-field${wide ? " wide" : ""}`}>
      <label htmlFor={id}>{f.label}</label>
      {f.type === "file" ? (
        <input id={id} className="pdfw-fileinp" type="file" accept={f.accept}
          onChange={(e) => onChange(f.key, e.target.files?.[0] || null)} />
      ) : f.type === "select" ? (
        <select id={id} value={v} onChange={(e) => onChange(f.key, e.target.value)}>
          {f.options.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
        </select>
      ) : (
        <input id={id} type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"} min={f.type === "number" ? 0 : undefined}
          inputMode={f.type === "number" ? "numeric" : undefined} placeholder={f.ph} autoComplete={f.type === "password" ? "new-password" : undefined}
          spellCheck={f.type === "text" ? false : undefined} value={v} onChange={(e) => onChange(f.key, e.target.value)} />
      )}
    </div>
  );
}

function PageThumbs({ file, spec, ordered, onChange }) {
  const [state, setState] = useState({ thumbs: [], total: 0, loading: true });
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ thumbs: [], total: 0, loading: true });
    import("../lib/pdfRender.js").then((m) => m.pdfThumbs(file.bytes, { signal: ctrl.signal }))
      .then((r) => !ctrl.signal.aborted && setState({ ...r, loading: false }))
      .catch(() => !ctrl.signal.aborted && setState({ thumbs: [], total: 0, loading: false }));
    return () => ctrl.abort();
  }, [file]);
  const chosen = safeIndices(spec, file.pages || state.total);
  const toggle = (i) => {
    const cur = [...chosen];
    const at = cur.indexOf(i);
    if (at >= 0) cur.splice(at, 1); else cur.push(i);
    onChange(specFrom(cur, ordered));
  };
  if (state.loading) return (
    <div className="pdfw-thumbs">
      <p className="hint" role="status">Loading page previews…</p>
      <div className="pdfw-tgrid" aria-hidden="true">{Array.from({ length: Math.min(file.pages || 6, 6) }, (_, i) => <span key={i} className="skel pdfw-tskel" />)}</div>
    </div>
  );
  if (!state.thumbs.length) return null;
  return (
    <div className="pdfw-thumbs">
      <div className="pdfw-tbar">
        <p className="hint">Tap pages to select them{ordered ? " — the order you tap becomes the new order" : ""}.{state.total > state.thumbs.length ? ` Previews cover the first ${state.thumbs.length} of ${state.total} pages; type the rest in the box.` : ""}</p>
        <span className="pdfw-tcount" aria-live="polite">{chosen.length ? `${chosen.length} selected` : "None selected"}</span>
        {chosen.length > 0 && <button type="button" className="btn qt sm" onClick={() => onChange("")}>Clear selection</button>}
      </div>
      <div className="pdfw-tgrid">
        {state.thumbs.map((src, i) => {
          const pos = chosen.indexOf(i);
          return (
            <button key={i} type="button" className="pdfw-thumb" aria-pressed={pos >= 0} aria-label={`Page ${i + 1}`} onClick={() => toggle(i)}>
              <span className="pdfw-timg"><img src={src} alt="" /></span>
              <span className="pdfw-tnum">{i + 1}</span>
              {pos >= 0 && <span className="pdfw-tmark" aria-hidden="true">{ordered ? pos + 1 : <Check strokeWidth={3} />}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Workspace({ tool, notify, onBack, onOpen, onStudio }) {
  const [files, setFiles] = useState([]);
  const [opts, setOpts] = useState({});
  const [busy, setBusy] = useState("");
  const [prog, setProg] = useState(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [drag, setDrag] = useState(false);
  const [said, setSaid] = useState("");
  const input = useRef(null);
  const resultsRef = useRef([]);
  resultsRef.current = results;
  useEffect(() => () => resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url)), []);

  const accept = tool.accept || "application/pdf";
  const noun = tool.accept ? (tool.multi ? "images" : "an image") : tool.multi ? "PDFs" : "a PDF";
  const clearResults = () => { results.forEach((r) => URL.revokeObjectURL(r.url)); setResults([]); };

  const add = async (list) => {
    const ok = [], picked = Array.from(list);
    for (const f of picked) {
      const good = tool.accept ? accept.split(",").includes(f.type) : f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!good) { notify(`${f.name}: unsupported file type.`); setError(`${f.name}: unsupported file type.`); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let pages = null;
      if (!tool.accept && !tool.noCount) { try { pages = await (await pdfOps()).pageCount(bytes); } catch { notify(`${f.name}: couldn't read this PDF${tool.id === "repair" ? "" : " (try Repair PDF)"}.`); setError(`${f.name}: couldn't read this PDF.`); if (tool.id !== "repair") continue; } }
      ok.push({ id: Math.random().toString(36).slice(2), name: f.name, type: f.type, size: f.size, bytes, pages });
    }
    if (!ok.length) return;
    if (ok.length === picked.length) setError("");
    clearResults();
    setFiles((p) => (tool.multi ? [...p, ...ok] : ok.slice(0, 1)));
  };

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= files.length) return;
    setFiles((p) => { const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setSaid(`${files[i].name} moved to position ${j + 1} of ${files.length}.`);
    clearResults();
  };
  const removeFile = (f) => { clearResults(); setError(""); setFiles((p) => p.filter((x) => x.id !== f.id)); setSaid(`${f.name} removed.`); };
  const startOver = () => { clearResults(); setError(""); setFiles([]); };

  const run = async () => {
    if (files.length < (tool.min || 1)) return notify(tool.min ? `Add at least ${tool.min} files.` : "Add a file first.");
    clearResults(); setError(""); setProg(null); setBusy("Working…");
    try {
      const out = await tool.run(files, opts, (i, n) => { setBusy(`Page ${i} of ${n}…`); setProg(n ? i / n : null); });
      setResults(out.map((r) => ({ ...r, url: URL.createObjectURL(r.blob), size: r.blob.size })));
    } catch (e) {
      const m = e?.message || "Something went wrong.";
      notify(m); setError(m);
    } finally { setBusy(""); setProg(null); }
  };

  const inSize = files.reduce((s, f) => s + f.size, 0);
  const rec = error ? recovery(error, tool.id) : null;
  const goTool = rec?.go && TOOLS.find((t) => t.id === rec.go);
  const short = files.length > 0 && tool.min && files.length < tool.min;
  const outSize = results.length === 1 && files.length === 1 ? results[0].size : null;
  const delta = outSize != null && inSize ? Math.round((1 - outSize / inSize) * 100) : 0;

  return (
    <div className="pdfw">
      <SubHead icon={tool.ico} title={tool.name} desc={tool.desc} onBack={onBack} />
      {SHEAF[tool.id] && (
        <div className="pdfw-studio">
          <button type="button" className="btn gh sm" onClick={() => onStudio(SHEAF[tool.id])}><Layers size={15} aria-hidden="true" />Open in visual editor</button>
          <span>Drag pages and see changes live in Sheaf PDF Studio</span>
        </div>
      )}
      <div className="panel">
        <div className="pb">
          <div className={`pdfw-drop${drag ? " is-over" : ""}${files.length ? " is-compact" : ""}`}
            onClick={(e) => { if (!e.target.closest("button")) input.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
            <span className="pdfw-dropic" aria-hidden="true"><FileUp /></span>
            <span className="pdfw-droptx">
              <b>{drag ? "Drop to add" : files.length ? (tool.multi ? `Add more ${noun}` : `Replace with another ${tool.accept ? "image" : "PDF"}`) : `Drop ${noun} here`}</b>
              <span className="pdfw-dropsub">{tool.multi ? "Select several at once, or add them one by one" : "One file at a time"}</span>
            </span>
            <button type="button" className="btn pdfw-choose" onClick={(e) => { e.stopPropagation(); input.current?.click(); }}>
              {files.length ? (tool.multi ? "Add files" : "Choose another") : tool.accept ? "Choose images" : tool.multi ? "Choose PDFs" : "Choose PDF"}
            </button>
            <LocalNote />
          </div>
          <input ref={input} type="file" accept={accept} multiple={!!tool.multi} hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

          {files.length > 0 && (
            <section className="pdfw-sec" aria-labelledby={`${tool.id}-files`}>
              <div className="pdfw-sechead">
                <h3 className="pdfw-label" id={`${tool.id}-files`}>{tool.multi ? `${files.length} file${files.length > 1 ? "s" : ""}` : "Selected file"}</h3>
                {tool.multi && files.length > 1 && <button type="button" className="btn qt sm" onClick={startOver}>Remove all</button>}
              </div>
              {tool.multi && files.length > 1 && <p className="hint pdfw-order">{tool.order}</p>}
              <ol className={`pdfw-files${tool.multi ? " ordered" : ""}`}>
                {files.map((f, i) => (
                  <li key={f.id} className="pdfw-file">
                    {tool.multi && <span className="pdfw-pos"><span className="sr-only">Position </span>{i + 1}</span>}
                    <FileText className="pdfw-fic" aria-hidden="true" />
                    <span className="pdfw-fmeta">
                      <span className="pdfw-fname" title={f.name}>{f.name}</span>
                      <span className="pdfw-fsub">{f.pages ? `${f.pages} page${f.pages > 1 ? "s" : ""} · ` : ""}{kb(f.size)}</span>
                    </span>
                    {tool.multi && files.length > 1 && <>
                      <button type="button" className="btn qt ico sm pdfw-ibtn" aria-label={`Move ${f.name} up`} aria-disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp aria-hidden="true" /></button>
                      <button type="button" className="btn qt ico sm pdfw-ibtn" aria-label={`Move ${f.name} down`} aria-disabled={i === files.length - 1} onClick={() => move(i, 1)}><ChevronDown aria-hidden="true" /></button>
                    </>}
                    <button type="button" className="btn qt ico sm pdfw-ibtn" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f)}><X aria-hidden="true" /></button>
                  </li>
                ))}
              </ol>
              <p className="sr-only" aria-live="polite">{said}</p>
            </section>
          )}

          {files.length > 0 && (tool.opts || tool.pick) && (
            <section className="pdfw-sec" aria-labelledby={`${tool.id}-set`}>
              <h3 className="pdfw-label" id={`${tool.id}-set`}>Settings</h3>
              {tool.opts && <div className="pdfw-opts">
                {tool.opts.map((f) => <Field key={f.key} f={f} value={opts[f.key]} onChange={(k, v) => setOpts((o) => ({ ...o, [k]: v }))} />)}
              </div>}
              {tool.pick && files.length === 1 && (
                <PageThumbs file={files[0]} spec={opts[tool.pick] || ""} ordered={tool.id === "organize"}
                  onChange={(v) => setOpts((o) => ({ ...o, [tool.pick]: v }))} />
              )}
            </section>
          )}

          {tool.heavy && files.some((f) => (f.pages || 0) > 150 || f.size > 50 * 1048576) && (
            <Notice tone="w" title="Large document">This runs on your device and may take a while or slow the tab. Keep this page open until it finishes.</Notice>
          )}

          {files.length > 0 && (
            <div className="pdfw-act">
              <button className="btn pri" disabled={!!busy} aria-describedby={short ? `${tool.id}-short` : undefined} onClick={run}>
                {busy ? <><LoaderCircle className="spin" aria-hidden="true" />Working…</> : tool.action || tool.name}
              </button>
              {short && <p className="hint" id={`${tool.id}-short`}>Add at least {tool.min} files to continue.</p>}
              {busy && <Progress label={busy} value={prog} />}
            </div>
          )}

          {rec && !busy && (
            <Notice tone={rec.tone} role="status" className="pdfw-err" title={error}
              actions={goTool ? <button type="button" className="linkbtn" onClick={() => onOpen(goTool.id)}>Open {goTool.name} →</button> : null}>
              {rec.hint}
            </Notice>
          )}

          {results.length > 0 && (
            <section className="pdfw-out" aria-label="Results">
              <Notice tone="ok" role="status" className="pdfw-done" title="Done · ">
                {results.length} file{results.length > 1 ? "s" : ""}
                {outSize != null && ` · ${kb(inSize)} → ${kb(outSize)}`}
                {outSize != null && delta > 0 && ` (${delta}% smaller)`}
              </Notice>
              <ul className="pdfw-files">
                {results.map((r) => (
                  <li key={r.name} className="pdfw-file">
                    <FileText className="pdfw-fic" aria-hidden="true" />
                    <span className="pdfw-fmeta"><span className="pdfw-fname" title={r.name}>{r.name}</span><span className="pdfw-fsub">{kb(r.size)}</span></span>
                    <button type="button" className="btn sm pdfw-dl" onClick={() => download(r)}>⬇ Download</button>
                  </li>
                ))}
              </ul>
              <div className="pdfw-outact">
                {results.length > 1 && (
                  <button type="button" className="btn pri" onClick={async () => {
                    try {
                      const { zipFiles } = await import("../lib/zip.js");
                      const blob = await zipFiles(results);
                      const url = URL.createObjectURL(blob);
                      download({ url, name: `${base(files[0] || { name: tool.id })}-${tool.id}.zip` });
                      setTimeout(() => URL.revokeObjectURL(url), 10000);
                    } catch { notify("Couldn't create the ZIP."); }
                  }}><Download aria-hidden="true" />Download all as ZIP</button>
                )}
                <button type="button" className="btn gh" onClick={startOver}><RotateCcw aria-hidden="true" />Start over</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ t, onOpen, cardRef }) {
  const Ico = t.ico;
  return (
    <button type="button" ref={cardRef} className="pdfh-card" onClick={() => onOpen(t.id)}>
      <span className="pdfh-ico" aria-hidden="true"><Ico /></span>
      <span className="pdfh-tx"><b>{t.name}</b><small>{t.short}</small></span>
      <ChevronRight className="pdfh-go" aria-hidden="true" />
    </button>
  );
}

export default function PdfTool({ notify, nav }) {
  const [id, setId] = useState(() => readParams().get("t") || "");
  useEffect(() => { writeParams({ t: id || null }); }, [id]);
  const [query, setQuery] = useState("");
  const tool = useMemo(() => TOOLS.find((t) => t.id === id), [id]);
  /* Back from a sub-tool returns focus to the card that opened it. */
  const cards = useRef({});
  const from = useRef("");
  const back = () => { from.current = id; setId(""); };
  useEffect(() => {
    if (!id && from.current) { cards.current[from.current]?.focus(); from.current = ""; }
  }, [id]);
  /* Sheaf is its own tool now; old ?t=sheaf / ?t=sheaf:<id> links go there. */
  const toStudio = (x) => nav(`/tool/sheaf${x ? `/${x}` : ""}`);
  useEffect(() => { if (id === "sheaf" || id.startsWith("sheaf:")) toStudio(id.slice(6)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (tool?.Custom) return (
    <Suspense fallback={<div className="pdfw"><p className="sr-only" role="status">Loading {tool.name}…</p><div className="skel pdfw-skel" aria-hidden="true" /></div>}>
      <tool.Custom notify={notify} onBack={back} icon={tool.ico} />
    </Suspense>
  );
  if (tool) return <Workspace key={tool.id} tool={tool} notify={notify} onBack={back} onOpen={setId} onStudio={toStudio} />;

  const q = query.trim().toLowerCase();
  const match = (t) => !q || (t.name + " " + t.short + " " + t.desc + " " + GROUPS[t.g].name).toLowerCase().includes(q);
  const shown = TOOLS.filter(match);

  return (
    <div className="pdfh">
      <div className="pdfh-top">
        <div className="pdfh-search">
          <Search aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search"
            placeholder={`Search ${TOOLS.length} PDF tools…`} aria-label="Search PDF tools" />
        </div>
        <LocalNote />
      </div>
      <p className="sr-only" aria-live="polite">{q ? `${shown.length} tool${shown.length === 1 ? "" : "s"} match` : ""}</p>
      {!q && (
        <button type="button" className="pdfh-studio" onClick={() => toStudio("")}>
          <span className="pdfh-sic" aria-hidden="true"><Layers /></span>
          <span className="pdfh-stx"><b>Sheaf PDF Studio <i>New</i></b>
            <small>A visual workspace for 15 of these tools: drag pages to reorder, rotate or delete them, see watermarks, page numbers, crops and signatures live on the page, then keep working on the result.</small></span>
          <ChevronRight className="pdfh-sgo" aria-hidden="true" />
        </button>
      )}
      {GROUPS.map((g, gi) => {
        const items = shown.filter((t) => t.g === gi);
        if (!items.length) return null;
        const GIco = g.ico;
        return (
          <section key={g.name} className="pdfh-sec" aria-labelledby={`pdfg-${gi}`}>
            <h2 className="pdfh-gh" id={`pdfg-${gi}`}><GIco aria-hidden="true" />{g.name}<i aria-hidden="true">{items.length}</i></h2>
            <div className="pdfh-grid">
              {items.map((t) => <ToolCard key={t.id} t={t} onOpen={setId} cardRef={(el) => { cards.current[t.id] = el; }} />)}
            </div>
          </section>
        );
      })}
      {!shown.length && (
        <EmptyState icon={Search} title={`No PDF tools match “${query}”`}
          actions={<button type="button" className="btn gh auto" onClick={() => setQuery("")}>Clear search</button>}>
          Try a shorter word like “merge”, “page” or “password”.
        </EmptyState>
      )}
      <p className="pdfh-na"><b>Not available (need a server) · </b>{NOT_AVAILABLE.join(" · ")}</p>
    </div>
  );
}
