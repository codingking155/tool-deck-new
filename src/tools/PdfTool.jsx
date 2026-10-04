import { useState } from "react";
import { formatBytes, parsePageRanges } from "../lib/pageRanges.js";
import { makeZip, saveBlob } from "../lib/zip.js";
import {
  pageCount, mergePdfs, extractGroups, compressLossless, compressRaster,
  pdfToImages, imagesToPdf, extractText,
} from "../lib/pdfOps.js";

const MAX_BYTES = 100 * 1024 * 1024;
const MODES = [
  ["merge", "Merge"],
  ["split", "Split"],
  ["compress", "Compress"],
  ["toimg", "PDF → Images"],
  ["fromimg", "Images → PDF"],
  ["text", "Extract text"],
];

const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const base = (name) => name.replace(/\.pdf$/i, "") || "document";
const pdfBlob = (bytes) => new Blob([bytes], { type: "application/pdf" });

function Drop({ accept, multiple, label, hint, onFiles }) {
  const [over, setOver] = useState(false);
  return (
    <label className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
      <span style={{ fontSize: 26 }} aria-hidden="true">📄</span>
      <b>{label}</b>
      <span style={{ fontSize: 12, color: "var(--tx3)" }}>{hint}</span>
      <input type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { onFiles([...e.target.files]); e.target.value = ""; }} />
    </label>
  );
}

function Progress({ value, label }) {
  return (
    <div style={{ margin: "14px 0" }} role="status">
      <div className="hint" style={{ marginBottom: 6 }}>{label} {Math.round(value * 100)}%</div>
      <div style={{ height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value * 100}%`, height: "100%", background: "var(--pri)", transition: "width .2s" }} />
      </div>
    </div>
  );
}

function FileList({ files, onMove, onRemove, showPages }) {
  return (
    <div className="flist">
      {files.map((f, i) => (
        <div className="frow" key={f.id}>
          {f.thumb ? <img src={f.thumb} alt="" /> : <span aria-hidden="true" style={{ fontSize: 20 }}>📄</span>}
          <span className="fn" title={f.name}>{f.name}</span>
          <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{showPages && f.pages != null ? `${f.pages} p · ` : ""}{formatBytes(f.size)}</span>
          {onMove && <>
            <button className="ib" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => onMove(i, -1)}>↑</button>
            <button className="ib" aria-label={`Move ${f.name} down`} disabled={i === files.length - 1} onClick={() => onMove(i, 1)}>↓</button>
          </>}
          <button className="ib" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

/* Shared state machine for "pick files → run → result". */
function useJob(notify) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true); setError(""); setProgress(0);
    try { await fn(setProgress); }
    catch (e) { setError(e?.message || String(e)); notify("Something went wrong — see the message"); }
    finally { setBusy(false); }
  };
  return { busy, progress, error, setError, run };
}

async function readPdfs(list, notify) {
  const out = [];
  for (const f of list) {
    if (!isPdf(f)) { notify(`${f.name} isn't a PDF`); continue; }
    if (f.size > MAX_BYTES) { notify(`${f.name} is over ${formatBytes(MAX_BYTES)}`); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let pages = null, err = "";
    try { pages = await pageCount(bytes, f.name); } catch (e) { err = e.message; }
    out.push({ id: `${Date.now()}-${Math.random()}`, name: f.name, size: f.size, bytes, pages, err });
  }
  return out;
}

function move(arr, i, d) {
  const a = [...arr];
  [a[i], a[i + d]] = [a[i + d], a[i]];
  return a;
}

function ErrorNote({ error }) {
  return error ? <div className="note w" style={{ marginTop: 14 }}><b>Couldn't finish · </b>{error}</div> : null;
}

function SingleFilePicker({ file, setFile, notify, job }) {
  const pick = async (list) => {
    const [f] = await readPdfs(list.slice(0, 1), notify);
    if (!f) return;
    if (f.err) { job.setError(f.err); return; }
    job.setError("");
    setFile(f);
  };
  return file ? (
    <FileList files={[file]} onRemove={() => setFile(null)} showPages />
  ) : (
    <Drop accept="application/pdf,.pdf" label="Drop a PDF here or tap to choose" hint={`Up to ${formatBytes(MAX_BYTES)} · stays on your device`} onFiles={pick} />
  );
}

function MergeView({ notify }) {
  const [files, setFiles] = useState([]);
  const job = useJob(notify);
  const add = async (list) => {
    const got = await readPdfs(list, notify);
    const bad = got.filter((f) => f.err);
    if (bad.length) job.setError(bad.map((b) => b.err).join(" "));
    setFiles((p) => [...p, ...got.filter((f) => !f.err)]);
  };
  const total = files.reduce((s, f) => s + (f.pages || 0), 0);
  return (
    <>
      <Drop accept="application/pdf,.pdf" multiple label="Drop PDFs here or tap to choose" hint="Add two or more · reorder with the arrows" onFiles={add} />
      {files.length > 0 && <FileList files={files} showPages onMove={(i, d) => setFiles((p) => move(p, i, d))} onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))} />}
      {job.busy && <Progress value={job.progress} label="Merging…" />}
      <button className="btn pri" style={{ marginTop: 14 }} disabled={files.length < 2 || job.busy}
        onClick={() => job.run(async (p) => {
          const out = await mergePdfs(files, p);
          saveBlob(pdfBlob(out), "merged.pdf");
          notify(`Merged ${files.length} PDFs · ${total} pages · ${formatBytes(out.length)}`);
        })}>
        {files.length < 2 ? "Add at least 2 PDFs" : `Merge ${files.length} PDFs (${total} pages)`}
      </button>
      <ErrorNote error={job.error} />
    </>
  );
}

function SplitView({ notify }) {
  const [file, setFile] = useState(null);
  const [how, setHow] = useState("ranges");
  const [ranges, setRanges] = useState("1-2");
  const job = useJob(notify);
  const parsed = file && how !== "each" ? parsePageRanges(ranges, file.pages) : null;
  const go = () => job.run(async () => {
    const groups = how === "each" ? Array.from({ length: file.pages }, (_, i) => [i])
      : how === "one" ? [parsed.groups.flat()] : parsed.groups;
    const outs = await extractGroups(file.bytes, file.name, groups);
    const label = (g) => (g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`);
    if (outs.length === 1) saveBlob(pdfBlob(outs[0]), `${base(file.name)}-${how === "one" ? "extract" : label(groups[0])}.pdf`);
    else saveBlob(new Blob([makeZip(outs.map((o, i) => ({ name: `${base(file.name)}-${label(groups[i])}.pdf`, data: o })))], { type: "application/zip" }), `${base(file.name)}-split.zip`);
    notify(outs.length === 1 ? "PDF saved" : `${outs.length} PDFs saved as .zip`);
  });
  return (
    <>
      <SingleFilePicker file={file} setFile={setFile} notify={notify} job={job} />
      {file && (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="pdf-how">How to split</label>
            <select id="pdf-how" value={how} onChange={(e) => setHow(e.target.value)}>
              <option value="ranges">Each range → its own PDF</option>
              <option value="one">Selected pages → one PDF</option>
              <option value="each">Every page → its own PDF</option>
            </select>
          </div>
          {how !== "each" && (
            <div className="field">
              <label htmlFor="pdf-ranges">Pages (1–{file.pages})</label>
              <input id="pdf-ranges" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="e.g. 1-3, 5, 8-" />
              <div className={parsed?.ok ? "hint" : "hint bad-tx"}>{parsed?.ok ? 'Commas separate ranges. "8-" means page 8 to the end.' : parsed?.error}</div>
            </div>
          )}
          <button className="btn pri" disabled={job.busy || (how !== "each" && !parsed?.ok)} onClick={go}>{job.busy ? "Working…" : "Split PDF"}</button>
        </div>
      )}
      <ErrorNote error={job.error} />
    </>
  );
}

const COMPRESS_LEVELS = {
  light: { label: "Light — lossless, keeps text selectable", raster: false },
  balanced: { label: "Strong — pages become images (120 dpi)", raster: true, dpi: 120, quality: 0.7 },
  max: { label: "Extreme — smallest file (96 dpi, lower quality)", raster: true, dpi: 96, quality: 0.5 },
};

function CompressView({ notify }) {
  const [file, setFile] = useState(null);
  const [level, setLevel] = useState("balanced");
  const [result, setResult] = useState(null);
  const job = useJob(notify);
  const lv = COMPRESS_LEVELS[level];
  const go = () => job.run(async (p) => {
    setResult(null);
    const out = lv.raster ? await compressRaster(file.bytes, file.name, lv, p) : await compressLossless(file.bytes, file.name);
    setResult({ bytes: out, before: file.size, after: out.length });
  });
  const saved = result ? Math.round((1 - result.after / result.before) * 100) : 0;
  return (
    <>
      <SingleFilePicker file={file} setFile={(f) => { setFile(f); setResult(null); }} notify={notify} job={job} />
      {file && (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="pdf-lvl">Compression</label>
            <select id="pdf-lvl" value={level} onChange={(e) => { setLevel(e.target.value); setResult(null); }}>
              {Object.entries(COMPRESS_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {lv.raster && <div className="hint">Best for scans and photo-heavy PDFs. Text and links won't be selectable or clickable afterwards.</div>}
          </div>
          {job.busy && <Progress value={job.progress} label="Compressing…" />}
          {!result && <button className="btn pri" disabled={job.busy} onClick={go}>{job.busy ? "Working…" : "Compress PDF"}</button>}
          {result && (
            <>
              <div className="pstat" style={{ marginBottom: 14 }}>
                <div className="pcell"><div className="k">Before</div><div className="v">{formatBytes(result.before)}</div></div>
                <div className="pcell"><div className="k">After</div><div className={`v ${saved > 0 ? "gd" : ""}`}>{formatBytes(result.after)}</div></div>
                <div className="pcell"><div className="k">Saved</div><div className="v">{saved > 0 ? `${saved}%` : "—"}</div></div>
              </div>
              {saved <= 0 ? (
                <div className="note i"><b>Already compact · </b>This setting couldn't make the file smaller.{lv.raster ? " It's likely mostly text — try Light." : " Try Strong for scanned or image-heavy PDFs."}</div>
              ) : (
                <button className="btn pri" onClick={() => saveBlob(pdfBlob(result.bytes), `${base(file.name)}-compressed.pdf`)}>Download compressed PDF</button>
              )}
            </>
          )}
        </div>
      )}
      <ErrorNote error={job.error} />
    </>
  );
}

function ToImagesView({ notify }) {
  const [file, setFile] = useState(null);
  const [type, setType] = useState("image/jpeg");
  const [dpi, setDpi] = useState(150);
  const job = useJob(notify);
  const go = () => job.run(async (p) => {
    const blobs = await pdfToImages(file.bytes, file.name, { dpi, type, quality: 0.88 }, p);
    const ext = type === "image/png" ? "png" : "jpg";
    if (blobs.length === 1) { saveBlob(blobs[0], `${base(file.name)}.${ext}`); return; }
    const files = await Promise.all(blobs.map(async (b, i) => ({ name: `${base(file.name)}-page-${String(i + 1).padStart(3, "0")}.${ext}`, data: new Uint8Array(await b.arrayBuffer()) })));
    saveBlob(new Blob([makeZip(files)], { type: "application/zip" }), `${base(file.name)}-images.zip`);
    notify(`${blobs.length} images saved as .zip`);
  });
  return (
    <>
      <SingleFilePicker file={file} setFile={setFile} notify={notify} job={job} />
      {file && (
        <div style={{ marginTop: 14 }}>
          <div className="two">
            <div className="field"><label htmlFor="pdf-it">Format</label>
              <select id="pdf-it" value={type} onChange={(e) => setType(e.target.value)}><option value="image/jpeg">JPG</option><option value="image/png">PNG</option></select></div>
            <div className="field"><label htmlFor="pdf-dpi">Resolution</label>
              <select id="pdf-dpi" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                <option value={72}>72 dpi · screen</option><option value={150}>150 dpi · standard</option><option value={300}>300 dpi · print</option>
              </select></div>
          </div>
          {job.busy && <Progress value={job.progress} label="Rendering pages…" />}
          <button className="btn pri" disabled={job.busy} onClick={go}>{job.busy ? "Working…" : `Convert ${file.pages} page${file.pages === 1 ? "" : "s"}`}</button>
        </div>
      )}
      <ErrorNote error={job.error} />
    </>
  );
}

function FromImagesView({ notify }) {
  const [files, setFiles] = useState([]);
  const [fit, setFit] = useState("a4");
  const job = useJob(notify);
  const add = (list) => {
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    if (imgs.length < list.length) notify("Skipped files that aren't images");
    setFiles((p) => [...p, ...imgs.map((f) => ({ id: `${Date.now()}-${Math.random()}`, name: f.name, size: f.size, file: f, thumb: URL.createObjectURL(f) }))]);
  };
  const remove = (id) => setFiles((p) => {
    const f = p.find((x) => x.id === id);
    if (f) URL.revokeObjectURL(f.thumb);
    return p.filter((x) => x.id !== id);
  });
  return (
    <>
      <Drop accept="image/*" multiple label="Drop images here or tap to choose" hint="JPG, PNG, WebP… one image per page" onFiles={add} />
      {files.length > 0 && <FileList files={files} onMove={(i, d) => setFiles((p) => move(p, i, d))} onRemove={remove} />}
      {files.length > 0 && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="pdf-fit">Page size</label>
          <select id="pdf-fit" value={fit} onChange={(e) => setFit(e.target.value)}>
            <option value="a4">A4 with margins (auto portrait/landscape)</option>
            <option value="image">Same size as each image</option>
          </select>
        </div>
      )}
      {job.busy && <Progress value={job.progress} label="Building PDF…" />}
      <button className="btn pri" style={{ marginTop: 6 }} disabled={!files.length || job.busy}
        onClick={() => job.run(async (p) => {
          const out = await imagesToPdf(files.map((f) => f.file), fit, p);
          saveBlob(pdfBlob(out), "images.pdf");
          notify(`PDF created · ${files.length} page${files.length === 1 ? "" : "s"} · ${formatBytes(out.length)}`);
        })}>
        {files.length ? `Create PDF (${files.length} page${files.length === 1 ? "" : "s"})` : "Add images first"}
      </button>
      <ErrorNote error={job.error} />
    </>
  );
}

function TextView({ notify }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState(null);
  const job = useJob(notify);
  const go = () => job.run(async (p) => {
    const pages = await extractText(file.bytes, file.name, p);
    setText(pages.some((t) => t) ? pages.map((t, i) => (pages.length > 1 ? `--- Page ${i + 1} ---\n${t}` : t)).join("\n\n") : "");
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); notify("Text copied"); }
    catch { notify("Copy failed — select the text and copy manually"); }
  };
  return (
    <>
      <SingleFilePicker file={file} setFile={(f) => { setFile(f); setText(null); }} notify={notify} job={job} />
      {file && text === null && (
        <>
          {job.busy && <Progress value={job.progress} label="Reading text…" />}
          <button className="btn pri" style={{ marginTop: 14 }} disabled={job.busy} onClick={go}>{job.busy ? "Working…" : "Extract text"}</button>
        </>
      )}
      {text === "" && <div className="note i" style={{ marginTop: 14 }}><b>No selectable text · </b>This PDF is probably scanned pages (images). Reading text from images (OCR) isn't supported yet.</div>}
      {text && (
        <div style={{ marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="pdf-text">Text · {text.length.toLocaleString()} characters</label>
            <textarea id="pdf-text" readOnly value={text} style={{ height: 320, fontFamily: "var(--body)", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn pri" onClick={copy}>Copy text</button>
            <button className="btn gh" style={{ whiteSpace: "nowrap" }} onClick={() => saveBlob(new Blob([text], { type: "text/plain" }), `${base(file.name)}.txt`)}>Download .txt</button>
          </div>
        </div>
      )}
      <ErrorNote error={job.error} />
    </>
  );
}

const VIEWS = { merge: MergeView, split: SplitView, compress: CompressView, toimg: ToImagesView, fromimg: FromImagesView, text: TextView };
const INTRO = {
  merge: "Combine several PDFs into one, in the order you choose.",
  split: "Pull out page ranges, or split every page into its own file.",
  compress: "Shrink a PDF for email or upload limits.",
  toimg: "Save each page as a JPG or PNG image.",
  fromimg: "Turn photos or scans into a single PDF.",
  text: "Copy the text out of a PDF.",
};

export default function PdfTool({ notify }) {
  const [mode, setMode] = useState("merge");
  const View = VIEWS[mode];
  return (
    <div>
      <div className="modes" role="tablist" aria-label="PDF action">
        {MODES.map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h3>{MODES.find(([k]) => k === mode)[1]}</h3><p>{INTRO[mode]}</p></div>
          <div className="pb"><View key={mode} notify={notify} /></div>
        </div>
        <div className="panel rise d2">
          <div className="ph"><h3>Private by design</h3><p>Your files are processed on this device.</p></div>
          <div className="pb">
            <div className="note i"><b>Nothing is uploaded · </b>Every action runs in your browser, so contracts, IDs and bank statements never leave your device. It also works offline once the page has loaded.</div>
            <div className="hint" style={{ lineHeight: 1.8 }}>
              • Password-protected PDFs need the password removed first.<br />
              • Strong compression turns pages into images, so text is no longer selectable.<br />
              • Text extraction reads real text only. Scanned pages need OCR, which isn't supported yet.<br />
              • Very large files (hundreds of pages) can take a while on phones.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
