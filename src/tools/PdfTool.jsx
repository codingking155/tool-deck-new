import { useState, useRef, useMemo, useEffect, lazy, Suspense } from "react";
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
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

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

const GROUPS = ["Organize", "Optimize", "Convert to PDF", "Convert from PDF", "Edit", "Security"];

/* run(files, opts, progress) -> [{ name, blob }]; files are [{ name, bytes }] */
const TOOLS = [
  { id: "merge", g: 0, icon: "🔗", name: "Merge PDF", desc: "Combine PDFs in the order you want.", multi: true, min: 2,
    run: async (fs) => [pdf(await (await pdfOps()).mergePdfs(fs.map((f) => f.bytes)), "merged.pdf")] },
  { id: "split", pick: "spec", g: 0, icon: "✂️", name: "Split PDF", desc: "One file per page, or per range group.",
    opts: [{ key: "spec", label: "Ranges, comma-separated groups (blank = every page)", type: "text", ph: "1-3, 4-6" }],
    run: async ([f], o) => (await (await pdfOps()).splitPdf(f.bytes, o.spec || "")).map((b, i) => pdf(b, `${base(f)}-part${i + 1}.pdf`)) },
  { id: "remove", pick: "pages", g: 0, icon: "🗑️", name: "Remove pages", desc: "Delete the pages you don't need.", opts: [PAGES],
    run: async ([f], o) => [pdf(await (await pdfOps()).removePages(f.bytes, o.pages || ""), `${base(f)}-trimmed.pdf`)] },
  { id: "extract", pick: "pages", g: 0, icon: "📤", name: "Extract pages", desc: "Pull selected pages into a new PDF.", opts: [PAGES],
    run: async ([f], o) => [pdf(await (await pdfOps()).extractPages(f.bytes, o.pages || ""), `${base(f)}-extract.pdf`)] },
  { id: "organize", pick: "pages", g: 0, icon: "🗂️", name: "Organize PDF", desc: "Reorder or duplicate pages — write the new order.",
    opts: [{ key: "pages", label: "New page order (e.g. 3,1,2 or 5-1)", type: "text", ph: "3,1,2" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).extractPages(f.bytes, o.pages || ""), `${base(f)}-organized.pdf`)] },

  { id: "compress", heavy: true, g: 1, icon: "🗜️", name: "Compress PDF", desc: "Smaller file by re-rendering pages as images (text becomes non-selectable).",
    opts: [{ key: "level", label: "Compression", type: "select", options: [["low", "Low — best quality"], ["medium", "Medium"], ["high", "High — smallest"]], def: "medium" }],
    run: async ([f], o, prog) => {
      const { compressPdf } = await import("../lib/pdfRender.js");
      const out = await compressPdf(f.bytes, { level: o.level || "medium", onProgress: prog });
      if (out.length >= f.bytes.length) throw new Error("Already well-optimised — re-rendering would not make this file smaller.");
      return [pdf(out, `${base(f)}-compressed.pdf`)];
    } },
  { id: "ocr", g: 1, icon: "🔎", name: "OCR PDF", desc: "Make scanned PDFs searchable and export the text.", Custom: OcrPdf },
  { id: "repair", g: 1, icon: "🩹", name: "Repair PDF", desc: "Rebuild a damaged PDF's structure and recover its pages.",
    run: async ([f]) => [pdf(await (await pdfOps()).rebuildPdf(f.bytes), `${base(f)}-repaired.pdf`)] },

  { id: "jpg2pdf", g: 2, icon: "🖼️", name: "JPG / PNG to PDF", desc: "Turn images into a PDF, one per page.", multi: true, accept: "image/jpeg,image/png",
    opts: [{ key: "fit", label: "Page size", type: "select", options: [["image", "Same as image"], ["a4", "A4 (fit)"]], def: "image" },
      { key: "margin", label: "Margin (pt)", type: "number", def: 0 }],
    run: async (fs, o) => [pdf(await (await pdfOps()).imagesToPdf(fs.map((f) => ({ bytes: f.bytes, type: /png$/i.test(f.type) ? "png" : "jpg" })), { fit: o.fit || "image", margin: Number(o.margin) || 0 }), "images.pdf")] },

  { id: "pdf2jpg", heavy: true, g: 3, icon: "📷", name: "PDF to JPG", desc: "Every page as a high-quality JPG.",
    opts: [{ key: "scale", label: "Resolution", type: "select", options: [["1.5", "Standard"], ["2", "High"], ["3", "Very high"]], def: "2" }],
    run: async ([f], o, prog) => {
      const { pdfToJpegs } = await import("../lib/pdfRender.js");
      const imgs = await pdfToJpegs(f.bytes, { scale: Number(o.scale) || 2, onProgress: prog });
      return imgs.map((b, i) => ({ name: `${base(f)}-page${i + 1}.jpg`, blob: new Blob([b], { type: "image/jpeg" }) }));
    } },
  { id: "pdf2word", heavy: true, g: 3, icon: "📝", name: "PDF to Word", desc: "Editable DOCX of the text (layout, images and tables are not kept).",
    run: async ([f], o, prog) => {
      const { pdfToDocx } = await import("../lib/pdfRender.js");
      const { blob } = await pdfToDocx(f.bytes, { onProgress: prog });
      return [{ name: `${base(f)}.docx`, blob }];
    } },

  { id: "rotate", pick: "pages", g: 4, icon: "🔄", name: "Rotate PDF", desc: "Rotate all pages, or just some.",
    opts: [{ key: "deg", label: "Rotate", type: "select", options: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° counter-clockwise"]], def: "90" },
      { key: "pages", label: "Pages (blank = all)", type: "text", ph: "2-4" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).rotatePdf(f.bytes, Number(o.deg) || 90, o.pages || ""), `${base(f)}-rotated.pdf`)] },
  { id: "numbers", g: 4, icon: "🔢", name: "Add page numbers", desc: "Stamp page numbers on every page.",
    opts: [{ key: "position", label: "Position", type: "select", options: [["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]], def: "bottom-center" },
      { key: "start", label: "Start at", type: "number", def: 1 }],
    run: async ([f], o) => [pdf(await (await pdfOps()).addPageNumbers(f.bytes, { position: o.position || "bottom-center", start: Number(o.start) || 1 }), `${base(f)}-numbered.pdf`)] },
  { id: "watermark", g: 4, icon: "💧", name: "Watermark", desc: "Diagonal text watermark on every page.",
    opts: [{ key: "text", label: "Watermark text", type: "text", ph: "CONFIDENTIAL" },
      { key: "opacity", label: "Opacity", type: "select", options: [["0.15", "Light"], ["0.25", "Medium"], ["0.5", "Strong"]], def: "0.25" },
      { key: "font", label: "Font file for non-Latin text (optional: .ttf, .otf, .woff)", type: "file", accept: ".ttf,.otf,.woff" }],
    run: async ([f], o) => [pdf(await (await pdfOps()).addWatermark(f.bytes, { text: o.text, opacity: Number(o.opacity) || 0.25,
      fontBytes: o.font ? new Uint8Array(await o.font.arrayBuffer()) : null }), `${base(f)}-watermarked.pdf`)] },
  { id: "compare", g: 4, icon: "🆚", name: "Compare PDF", desc: "Spot text and visual differences between two versions.", Custom: ComparePdf },
  { id: "crop", g: 4, icon: "✂", name: "Crop PDF", desc: "Trim margins off every page (points; 72 pt = 1 inch).",
    opts: ["top", "right", "bottom", "left"].map((k) => ({ key: k, label: `${k[0].toUpperCase() + k.slice(1)} (pt)`, type: "number", def: 0 })),
    run: async ([f], o) => [pdf(await (await pdfOps()).cropPdf(f.bytes, { top: +o.top || 0, right: +o.right || 0, bottom: +o.bottom || 0, left: +o.left || 0 }), `${base(f)}-cropped.pdf`)] },

  { id: "sign", g: 5, icon: "✍️", name: "Sign PDF", desc: "Draw, type or upload a signature and place it on any page.", Custom: SignPdf },
  { id: "unlock", noCount: true, g: 5, icon: "🔓", name: "Unlock PDF", desc: "Remove edit/print/copy restrictions, or the password if you know it.",
    opts: [{ key: "password", label: "Password (only if the PDF needs one to open)", type: "password" }],
    run: async ([f], o) => { const q = await qpdfOps(); return [pdf(await q.unlockPdf(f.bytes, o.password || "", q.rt), `${base(f)}-unlocked.pdf`)]; } },
  { id: "protect", noCount: true, g: 5, icon: "🔒", name: "Protect PDF", desc: "Encrypt with a password (AES-256) and optionally restrict printing, copying or editing.",
    opts: [{ key: "password", label: "Password to open the PDF", type: "password" },
      { key: "print", label: "Printing", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" },
      { key: "copy", label: "Copying text and images", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" },
      { key: "modify", label: "Editing", type: "select", options: [["y", "Allowed"], ["n", "Not allowed"]], def: "y" }],
    run: async ([f], o) => {
      const q = await qpdfOps();
      return [pdf(await q.protectPdf(f.bytes, { userPassword: o.password || "", allowPrint: (o.print || "y") === "y", allowCopy: (o.copy || "y") === "y", allowModify: (o.modify || "y") === "y" }, q.rt), `${base(f)}-protected.pdf`)];
    } },
];

const NOT_AVAILABLE = [
  "Word / PowerPoint / Excel / HTML to PDF", "PDF to PowerPoint / Excel / PDF/A",
  "Redact PDF", "Edit PDF text",
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
      {f.type === "file" ? (
        <input className="inp" type="file" accept={f.accept} style={{ marginTop: 4, paddingTop: 9 }}
          onChange={(e) => onChange(f.key, e.target.files?.[0] || null)} />
      ) : f.type === "select" ? (
        <select className="inp" value={v} onChange={(e) => onChange(f.key, e.target.value)} style={{ marginTop: 4 }}>
          {f.options.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
        </select>
      ) : (
        <input className="inp" type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"} min={f.type === "number" ? 0 : undefined} placeholder={f.ph} autoComplete={f.type === "password" ? "new-password" : undefined}
          value={v} onChange={(e) => onChange(f.key, e.target.value)} style={{ marginTop: 4 }} />
      )}
    </label>
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
  if (state.loading) return <div className="hint" style={{ marginTop: 12 }}>Loading page previews…</div>;
  if (!state.thumbs.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="hint">Tap pages to select them{ordered ? " — order of taps becomes the new order" : ""}.{state.total > state.thumbs.length ? ` Previews cover the first ${state.thumbs.length} of ${state.total} pages; type the rest in the box.` : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(84px,1fr))", gap: 8, marginTop: 8, maxHeight: 340, overflowY: "auto" }}>
        {state.thumbs.map((src, i) => {
          const pos = chosen.indexOf(i);
          return (
            <button key={i} type="button" aria-pressed={pos >= 0} aria-label={`Page ${i + 1}`} onClick={() => toggle(i)}
              style={{ position: "relative", padding: 4, background: "var(--panel)", cursor: "pointer", color: "var(--tx)",
                border: `2px solid ${pos >= 0 ? "var(--pri2)" : "var(--line)"}`, borderRadius: 8 }}>
              <img src={src} alt="" style={{ width: "100%", display: "block", borderRadius: 3 }} />
              <span style={{ fontSize: 11, color: "var(--tx3)" }}>{i + 1}</span>
              {pos >= 0 && ordered && <span style={{ position: "absolute", top: 6, right: 6, background: "var(--pri2)", color: "#000", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{pos + 1}</span>}
              {pos >= 0 && !ordered && <span style={{ position: "absolute", top: 6, right: 6, background: "var(--pri2)", color: "#000", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
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
      if (!tool.accept && !tool.noCount) { try { pages = await (await pdfOps()).pageCount(bytes); } catch { notify(`${f.name}: couldn't read this PDF${tool.id === "repair" ? "" : " (try Repair PDF)"}.`); if (tool.id !== "repair") continue; } }
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

        {tool.pick && files.length === 1 && (
          <PageThumbs file={files[0]} spec={opts[tool.pick] || ""} ordered={tool.id === "organize"}
            onChange={(v) => setOpts((o) => ({ ...o, [tool.pick]: v }))} />
        )}

        {tool.heavy && files.some((f) => (f.pages || 0) > 150 || f.size > 50 * 1048576) && (
          <div className="note w" style={{ marginTop: 12 }}><b>Large document · </b>this runs on your device and may take a while or slow the tab. Keep this page open until it finishes.</div>
        )}

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
            {results.length > 1 && (
              <button className="btn" style={{ marginTop: 12 }} onClick={async () => {
                try {
                  const { zipFiles } = await import("../lib/zip.js");
                  const blob = await zipFiles(results);
                  const url = URL.createObjectURL(blob);
                  download({ url, name: `${base(files[0] || { name: tool.id })}-${tool.id}.zip` });
                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                } catch { notify("Couldn't create the ZIP."); }
              }}>⬇ Download all as ZIP</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PdfTool({ notify }) {
  const [id, setId] = useState(() => readParams().get("t") || "");
  useEffect(() => { writeParams({ t: id || null }); }, [id]);
  const [query, setQuery] = useState("");
  const tool = useMemo(() => TOOLS.find((t) => t.id === id), [id]);

  if (tool?.Custom) return (
    <Suspense fallback={<div className="hint" style={{ textAlign: "center", padding: 30 }}>Loading…</div>}>
      <tool.Custom notify={notify} onBack={() => setId("")} />
    </Suspense>
  );
  if (tool) return <Workspace key={tool.id} tool={tool} notify={notify} onBack={() => setId("")} />;

  const q = query.trim().toLowerCase();
  const match = (t) => !q || (t.name + " " + t.desc).toLowerCase().includes(q);
  const shown = TOOLS.filter(match);

  return (
    <div className="pdfh">
      <div className="pdfh-search">
        <span aria-hidden="true">🔍</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${TOOLS.length} PDF tools…`} aria-label="Search PDF tools" />
      </div>
      {GROUPS.map((g, gi) => {
        const items = shown.filter((t) => t.g === gi);
        if (!items.length) return null;
        return (
          <section key={g}>
            <h3 className="pdfh-gh">{g}<i>{items.length}</i></h3>
            <div className="pdfh-grid">
              {items.map((t) => (
                <button key={t.id} className="pdfh-card" onClick={() => setId(t.id)}>
                  <span className="pdfh-ico" aria-hidden="true">{t.icon}</span>
                  <b>{t.name}</b>
                  <small>{t.desc}</small>
                  <span className="pdfh-go" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {!shown.length && <div className="pdfh-empty">No tools match “{query}”.</div>}
      <div className="note i"><b>Privacy · </b>every tool here runs locally in your browser — files are never uploaded.</div>
      <div className="note w" style={{ marginTop: 10 }}><b>Not available (need a server) · </b>{NOT_AVAILABLE.join(" · ")}</div>
    </div>
  );
}
