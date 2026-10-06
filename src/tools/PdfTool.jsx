import { useState, useRef, useMemo, useEffect } from "react";
import {
  mergePdfs, extractPages, removePages, splitPdf, rotatePdf, addPageNumbers,
  addWatermark, cropPdf, rebuildPdf, imagesToPdf, pageCount,
} from "../lib/pdf.js";
import { readParams, writeParams } from "../hooks/index.js";

const PAGES = { key: "pages", label: "Pages (e.g. 1-3, 5, 8-)", type: "text", ph: "1-3, 5" };
const base = (f) => f.name.replace(/\.[^.]+$/, "");
const pdf = (bytes, name) => ({ name, blob: new Blob([bytes], { type: "application/pdf" }) });
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

const GROUPS = ["Organize", "Optimize", "Convert to PDF", "Convert from PDF", "Edit", "Security"];

/* run(files, opts, progress) -> [{ name, blob }]; files are [{ name, bytes }] */
const TOOLS = [
  { id: "merge", g: 0, icon: "🔗", name: "Merge PDF", desc: "Combine PDFs in the order you want.", multi: true, min: 2,
    run: async (fs) => [pdf(await mergePdfs(fs.map((f) => f.bytes)), "merged.pdf")] },
  { id: "split", g: 0, icon: "✂️", name: "Split PDF", desc: "One file per page, or per range group.",
    opts: [{ key: "spec", label: "Ranges, comma-separated groups (blank = every page)", type: "text", ph: "1-3, 4-6" }],
    run: async ([f], o) => (await splitPdf(f.bytes, o.spec || "")).map((b, i) => pdf(b, `${base(f)}-part${i + 1}.pdf`)) },
  { id: "remove", g: 0, icon: "🗑️", name: "Remove pages", desc: "Delete the pages you don't need.", opts: [PAGES],
    run: async ([f], o) => [pdf(await removePages(f.bytes, o.pages || ""), `${base(f)}-trimmed.pdf`)] },
  { id: "extract", g: 0, icon: "📤", name: "Extract pages", desc: "Pull selected pages into a new PDF.", opts: [PAGES],
    run: async ([f], o) => [pdf(await extractPages(f.bytes, o.pages || ""), `${base(f)}-extract.pdf`)] },
  { id: "organize", g: 0, icon: "🗂️", name: "Organize PDF", desc: "Reorder or duplicate pages — write the new order.",
    opts: [{ key: "pages", label: "New page order (e.g. 3,1,2 or 5-1)", type: "text", ph: "3,1,2" }],
    run: async ([f], o) => [pdf(await extractPages(f.bytes, o.pages || ""), `${base(f)}-organized.pdf`)] },

  { id: "compress", g: 1, icon: "🗜️", name: "Compress PDF", desc: "Smaller file by re-rendering pages as images (text becomes non-selectable).",
    opts: [{ key: "level", label: "Compression", type: "select", options: [["low", "Low — best quality"], ["medium", "Medium"], ["high", "High — smallest"]], def: "medium" }],
    run: async ([f], o, prog) => {
      const { compressPdf } = await import("../lib/pdfRender.js");
      const out = await compressPdf(f.bytes, { level: o.level || "medium", onProgress: prog });
      if (out.length >= f.bytes.length) throw new Error("Already well-optimised — re-rendering would not make this file smaller.");
      return [pdf(out, `${base(f)}-compressed.pdf`)];
    } },
  { id: "repair", g: 1, icon: "🩹", name: "Repair PDF", desc: "Rebuild a damaged PDF's structure and recover its pages.",
    run: async ([f]) => [pdf(await rebuildPdf(f.bytes), `${base(f)}-repaired.pdf`)] },

  { id: "jpg2pdf", g: 2, icon: "🖼️", name: "JPG / PNG to PDF", desc: "Turn images into a PDF, one per page.", multi: true, accept: "image/jpeg,image/png",
    opts: [{ key: "fit", label: "Page size", type: "select", options: [["image", "Same as image"], ["a4", "A4 (fit)"]], def: "image" },
      { key: "margin", label: "Margin (pt)", type: "number", def: 0 }],
    run: async (fs, o) => [pdf(await imagesToPdf(fs.map((f) => ({ bytes: f.bytes, type: /png$/i.test(f.type) ? "png" : "jpg" })), { fit: o.fit || "image", margin: Number(o.margin) || 0 }), "images.pdf")] },

  { id: "pdf2jpg", g: 3, icon: "📷", name: "PDF to JPG", desc: "Every page as a high-quality JPG.",
    opts: [{ key: "scale", label: "Resolution", type: "select", options: [["1.5", "Standard"], ["2", "High"], ["3", "Very high"]], def: "2" }],
    run: async ([f], o, prog) => {
      const { pdfToJpegs } = await import("../lib/pdfRender.js");
      const imgs = await pdfToJpegs(f.bytes, { scale: Number(o.scale) || 2, onProgress: prog });
      return imgs.map((b, i) => ({ name: `${base(f)}-page${i + 1}.jpg`, blob: new Blob([b], { type: "image/jpeg" }) }));
    } },
  { id: "pdf2word", g: 3, icon: "📝", name: "PDF to Word", desc: "Editable DOCX of the text (layout, images and tables are not kept).",
    run: async ([f], o, prog) => {
      const { pdfToDocx } = await import("../lib/pdfRender.js");
      const { blob } = await pdfToDocx(f.bytes, { onProgress: prog });
      return [{ name: `${base(f)}.docx`, blob }];
    } },

  { id: "rotate", g: 4, icon: "🔄", name: "Rotate PDF", desc: "Rotate all pages, or just some.",
    opts: [{ key: "deg", label: "Rotate", type: "select", options: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° counter-clockwise"]], def: "90" },
      { key: "pages", label: "Pages (blank = all)", type: "text", ph: "2-4" }],
    run: async ([f], o) => [pdf(await rotatePdf(f.bytes, Number(o.deg) || 90, o.pages || ""), `${base(f)}-rotated.pdf`)] },
  { id: "numbers", g: 4, icon: "🔢", name: "Add page numbers", desc: "Stamp page numbers on every page.",
    opts: [{ key: "position", label: "Position", type: "select", options: [["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]], def: "bottom-center" },
      { key: "start", label: "Start at", type: "number", def: 1 }],
    run: async ([f], o) => [pdf(await addPageNumbers(f.bytes, { position: o.position || "bottom-center", start: Number(o.start) || 1 }), `${base(f)}-numbered.pdf`)] },
  { id: "watermark", g: 4, icon: "💧", name: "Watermark", desc: "Diagonal text watermark on every page.",
    opts: [{ key: "text", label: "Watermark text", type: "text", ph: "CONFIDENTIAL" },
      { key: "opacity", label: "Opacity", type: "select", options: [["0.15", "Light"], ["0.25", "Medium"], ["0.5", "Strong"]], def: "0.25" }],
    run: async ([f], o) => [pdf(await addWatermark(f.bytes, { text: o.text, opacity: Number(o.opacity) || 0.25 }), `${base(f)}-watermarked.pdf`)] },
  { id: "crop", g: 4, icon: "✂", name: "Crop PDF", desc: "Trim margins off every page (points; 72 pt = 1 inch).",
    opts: ["top", "right", "bottom", "left"].map((k) => ({ key: k, label: `${k[0].toUpperCase() + k.slice(1)} (pt)`, type: "number", def: 0 })),
    run: async ([f], o) => [pdf(await cropPdf(f.bytes, { top: +o.top || 0, right: +o.right || 0, bottom: +o.bottom || 0, left: +o.left || 0 }), `${base(f)}-cropped.pdf`)] },

  { id: "unlock", g: 5, icon: "🔓", name: "Unlock PDF", desc: "Remove edit/print/copy restrictions. Cannot break an open-password.",
    run: async ([f]) => [pdf(await rebuildPdf(f.bytes), `${base(f)}-unlocked.pdf`)] },
];

const NOT_AVAILABLE = [
  "Word / PowerPoint / Excel / HTML to PDF", "PDF to PowerPoint / Excel / PDF/A", "OCR (scanned PDFs)",
  "Protect with password", "Sign PDF", "Redact PDF", "Compare PDF", "Edit PDF text",
];

function download(item) {
  const a = document.createElement("a");
  a.href = item.url; a.download = item.name;
  document.body.appendChild(a); a.click(); a.remove();
}

function Field({ f, value, onChange }) {
  const v = value ?? f.def ?? "";
  return (
    <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>
      <span style={{ color: "var(--tx3)" }}>{f.label}</span>
      {f.type === "select" ? (
        <select className="inp" value={v} onChange={(e) => onChange(f.key, e.target.value)} style={{ marginTop: 4 }}>
          {f.options.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
        </select>
      ) : (
        <input className="inp" type={f.type === "number" ? "number" : "text"} min={f.type === "number" ? 0 : undefined} placeholder={f.ph}
          value={v} onChange={(e) => onChange(f.key, e.target.value)} style={{ marginTop: 4 }} />
      )}
    </label>
  );
}

function Workspace({ tool, notify, onBack }) {
  const [files, setFiles] = useState([]);
  const [opts, setOpts] = useState({});
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState([]);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const resultsRef = useRef([]);
  resultsRef.current = results;
  useEffect(() => () => resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url)), []);

  const accept = tool.accept || "application/pdf";
  const clearResults = () => { results.forEach((r) => URL.revokeObjectURL(r.url)); setResults([]); };

  const add = async (list) => {
    const ok = [];
    for (const f of Array.from(list)) {
      const good = tool.accept ? accept.split(",").includes(f.type) : f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!good) { notify(`${f.name}: unsupported file type.`); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let pages = null;
      if (!tool.accept) { try { pages = await pageCount(bytes); } catch { notify(`${f.name}: couldn't read this PDF${tool.id === "repair" ? "" : " (try Repair PDF)"}.`); if (tool.id !== "repair") continue; } }
      ok.push({ id: Math.random().toString(36).slice(2), name: f.name, type: f.type, size: f.size, bytes, pages });
    }
    if (!ok.length) return;
    clearResults();
    setFiles((p) => (tool.multi ? [...p, ...ok] : ok.slice(0, 1)));
  };

  const move = (i, d) => setFiles((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const run = async () => {
    if (files.length < (tool.min || 1)) return notify(tool.min ? `Add at least ${tool.min} files.` : "Add a file first.");
    clearResults(); setBusy("Working…");
    try {
      const out = await tool.run(files, opts, (i, n) => setBusy(`Page ${i} of ${n}…`));
      setResults(out.map((r) => ({ ...r, url: URL.createObjectURL(r.blob), size: r.blob.size })));
    } catch (e) {
      notify(e?.message || "Something went wrong.");
    } finally { setBusy(""); }
  };

  const inSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="panel rise d1" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="ph">
        <button className="btn gh" onClick={onBack} style={{ float: "right" }}>← All PDF tools</button>
        <h3>{tool.icon} {tool.name}</h3><p>{tool.desc}</p>
      </div>
      <div className="pb">
        <div role="button" tabIndex={0} aria-label="Choose files"
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          style={{ border: `2px dashed ${drag ? "var(--good)" : "var(--line)"}`, borderRadius: 12, padding: 28, textAlign: "center", cursor: "pointer", color: "var(--tx)" }}>
          <div style={{ fontSize: 28 }}>⬆️</div>
          <b>Click or drop {tool.accept ? "images" : tool.multi ? "PDFs" : "a PDF"} here</b>
          <div style={{ fontSize: 12, color: "var(--tx3)" }}>{tool.multi ? "Select several files" : "One file"} · processed in your browser, never uploaded</div>
        </div>
        <input ref={input} type="file" accept={accept} multiple={!!tool.multi} hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

        {files.map((f, i) => (
          <div key={f.id} className="kv" style={{ alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className="k" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.name}</span>
            <span className="v">{kb(f.size)}{f.pages ? ` · ${f.pages} p` : ""}</span>
            {tool.multi && files.length > 1 && <>
              <button className="pill" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
              <button className="pill" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
            </>}
            <button className="pill" aria-label={`Remove ${f.name}`} onClick={() => { clearResults(); setFiles((p) => p.filter((x) => x.id !== f.id)); }}>✕</button>
          </div>
        ))}

        {files.length > 0 && tool.opts?.map((f) => <Field key={f.key} f={f} value={opts[f.key]} onChange={(k, v) => setOpts((o) => ({ ...o, [k]: v }))} />)}

        {files.length > 0 && (
          <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={!!busy} onClick={run}>{busy || `${tool.name}`}</button>
        )}

        {results.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="note i"><b>Done · </b>{results.length} file{results.length > 1 ? "s" : ""}
              {results.length === 1 && files.length === 1 && ` · ${kb(inSize)} → ${kb(results[0].size)}`}</div>
            {results.map((r) => (
              <div key={r.name} className="kv" style={{ alignItems: "center", gap: 8, marginTop: 8 }}>
                <span className="k" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span className="v">{kb(r.size)}</span>
                <button className="pill" onClick={() => download(r)}>⬇ Download</button>
              </div>
            ))}
            {results.length > 1 && <button className="btn" style={{ marginTop: 12 }} onClick={() => results.forEach(download)}>⬇ Download all</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PdfTool({ notify }) {
  const [id, setId] = useState(() => readParams().get("t") || "");
  useEffect(() => { writeParams({ t: id || null }); }, [id]);
  const tool = useMemo(() => TOOLS.find((t) => t.id === id), [id]);

  if (tool) return <Workspace key={tool.id} tool={tool} notify={notify} onBack={() => setId("")} />;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {GROUPS.map((g, gi) => (
        <section key={g} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, color: "var(--tx3)", margin: "0 0 8px" }}>{g}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
            {TOOLS.filter((t) => t.g === gi).map((t) => (
              <button key={t.id} className="panel" onClick={() => setId(t.id)}
                style={{ textAlign: "left", padding: 14, cursor: "pointer", color: "var(--tx)", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: 22 }}>{t.icon}</div>
                <b>{t.name}</b>
                <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="note i"><b>Privacy · </b>every tool here runs locally in your browser — files are never uploaded.</div>
      <div className="note w" style={{ marginTop: 10 }}><b>Not available (need a server) · </b>{NOT_AVAILABLE.join(" · ")}</div>
    </div>
  );
}
