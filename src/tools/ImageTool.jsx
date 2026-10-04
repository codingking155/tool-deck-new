import { useState, useEffect, useRef, useCallback } from "react";
import { formatBytes } from "../lib/pageRanges.js";
import { makeZip, saveBlob } from "../lib/zip.js";

const MAX_FILES = 30;
const MAX_BYTES = 40 * 1024 * 1024;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const OUT_FORMATS = [["auto", "Same as original"], ["image/jpeg", "JPG"], ["image/webp", "WebP"], ["image/png", "PNG"]];

function targetType(file, fmt) {
  if (fmt !== "auto") return fmt;
  return EXT[file.type] ? file.type : "image/jpeg";
}

function renameFor(name, type) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${EXT[type]}`;
}

async function decode(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function processOne(file, s) {
  const src = await decode(file);
  const w0 = src.width, h0 = src.height;
  const maxW = Number(s.maxW) || Infinity, maxH = Number(s.maxH) || Infinity;
  const scale = Math.min(1, maxW / w0, maxH / h0);
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const type = targetType(file, s.format);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (type === "image/jpeg") { ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  src.close?.();

  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), type, s.quality / 100));
  canvas.width = canvas.height = 0;
  const unsupported = blob.type !== type;
  const resized = scale < 1;
  /* Re-encoding an already-optimised file in the same format can grow it; keep the original then. */
  const keptOriginal = !resized && !unsupported && blob.size >= file.size && file.type === type;
  const out = keptOriginal ? file : blob;
  return {
    blob: out, type: out.type, name: renameFor(file.name, out.type),
    w0, h0, w, h, before: file.size, after: out.size, keptOriginal, unsupported, requested: type,
  };
}

function FileRow({ item, onRemove }) {
  const r = item.result;
  const pct = r ? Math.round((1 - r.after / r.before) * 100) : 0;
  return (
    <div className="frow">
      <img src={item.thumb} alt="" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fn" title={item.file.name}>{item.file.name}</div>
        <div style={{ fontSize: 12, marginTop: 2 }}>
          {item.error ? <span className="bad-tx">{item.error}</span>
            : !r ? <span>Working…</span>
            : (
              <>
                {formatBytes(r.before)} → <b style={{ color: "var(--tx)" }}>{formatBytes(r.after)}</b>{" "}
                <span className={pct > 0 ? "good-tx" : pct < 0 ? "warn-tx" : ""}>
                  {pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : "same"}
                </span>
                {" · "}{r.w}×{r.h}{r.w !== r.w0 ? ` (from ${r.w0}×${r.h0})` : ""}
                {r.keptOriginal && <> · <span title="Re-encoding would have made it bigger">kept original</span></>}
                {r.unsupported && <> · <span className="warn-tx">your browser can't save {EXT[r.requested].toUpperCase()}; saved as {EXT[r.type]?.toUpperCase() || r.type}</span></>}
              </>
            )}
        </div>
      </div>
      {r && <button className="ib" aria-label={`Download ${r.name}`} title="Download" onClick={() => saveBlob(r.blob, r.name)}>⬇</button>}
      <button className="ib" aria-label={`Remove ${item.file.name}`} title="Remove" onClick={onRemove}>✕</button>
    </div>
  );
}

export default function ImageTool({ notify }) {
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState("image/webp");
  const [quality, setQuality] = useState(75);
  const [maxW, setMaxW] = useState("");
  const [maxH, setMaxH] = useState("");
  const [bg, setBg] = useState("#ffffff");
  const [over, setOver] = useState(false);
  const runRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => () => itemsRef.current.forEach((it) => URL.revokeObjectURL(it.thumb)), []);

  const addFiles = useCallback((list) => {
    const incoming = [...list];
    const imgs = incoming.filter((f) => f.type.startsWith("image/"));
    if (imgs.length < incoming.length) notify("Skipped files that aren't images");
    const fit = imgs.filter((f) => f.size <= MAX_BYTES);
    if (fit.length < imgs.length) notify(`Skipped images over ${formatBytes(MAX_BYTES)}`);
    setItems((prev) => {
      const room = MAX_FILES - prev.length;
      if (fit.length > room) notify(`Up to ${MAX_FILES} images at a time`);
      return [...prev, ...fit.slice(0, Math.max(0, room)).map((file) => ({
        id: `${Date.now()}-${Math.random()}`, file, thumb: URL.createObjectURL(file), result: null, error: null,
      }))];
    });
  }, [notify]);

  const fileKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    if (!items.length) return;
    const run = ++runRef.current;
    const settings = { format, quality, maxW, maxH, bg };
    const t = setTimeout(async () => {
      for (const it of itemsRef.current) {
        if (runRef.current !== run) return;
        let patch;
        try { patch = { result: await processOne(it.file, settings), error: null }; }
        catch { patch = { result: null, error: "Your browser can't read this image (HEIC/RAW aren't supported)" }; }
        if (runRef.current !== run) return;
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, ...patch } : p)));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [fileKey, format, quality, maxW, maxH, bg]);

  const remove = (id) => setItems((prev) => {
    const it = prev.find((p) => p.id === id);
    if (it) URL.revokeObjectURL(it.thumb);
    return prev.filter((p) => p.id !== id);
  });
  const clear = () => { items.forEach((it) => URL.revokeObjectURL(it.thumb)); setItems([]); };

  const done = items.filter((i) => i.result);
  const before = done.reduce((s, i) => s + i.result.before, 0);
  const after = done.reduce((s, i) => s + i.result.after, 0);
  const busy = items.some((i) => !i.result && !i.error);

  const downloadAll = async () => {
    if (done.length === 1) { saveBlob(done[0].result.blob, done[0].result.name); return; }
    const files = await Promise.all(done.map(async (i) => ({ name: i.result.name, data: new Uint8Array(await i.result.blob.arrayBuffer()) })));
    saveBlob(new Blob([makeZip(files)], { type: "application/zip" }), "images.zip");
  };

  const lossy = format !== "image/png";
  return (
    <div className="grid2">
      <div className="panel rise d1">
        <div className="ph"><h3>Images</h3><p>JPG, PNG, WebP, GIF, BMP or AVIF · up to {MAX_FILES} at once. Nothing is uploaded.</p></div>
        <div className="pb">
          <label className={`dropzone${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
            <span style={{ fontSize: 26 }} aria-hidden="true">🖼️</span>
            <b>Drop images here or tap to choose</b>
            <span style={{ fontSize: 12, color: "var(--tx3)" }}>Processed on your device</span>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {items.length > 0 && (
            <div className="flist">
              {items.map((it) => <FileRow key={it.id} item={it} onRemove={() => remove(it.id)} />)}
            </div>
          )}
        </div>
      </div>

      <div className="panel rise d2">
        <div className="ph"><h3>Settings</h3><p>Changes re-run automatically.</p></div>
        <div className="pb">
          <div className="field">
            <label htmlFor="img-fmt">Convert to</label>
            <select id="img-fmt" value={format} onChange={(e) => setFormat(e.target.value)}>
              {OUT_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="img-q">Quality · {quality}%</label>
            <input id="img-q" type="range" min="10" max="100" step="1" value={quality} onChange={(e) => setQuality(Number(e.target.value))}
              disabled={!lossy} style={{ width: "100%", padding: 0, height: 32, minHeight: 0, accentColor: "var(--pri)" }} />
            <div className="hint">
              {lossy ? "70–80% is usually indistinguishable from the original." : "PNG is lossless, so quality doesn't apply — resize, or convert to WebP, to make it smaller."}
            </div>
          </div>
          <div className="two">
            <div className="field"><label htmlFor="img-w">Max width (px)</label><input id="img-w" type="number" min="1" inputMode="numeric" placeholder="Original" value={maxW} onChange={(e) => setMaxW(e.target.value)} /></div>
            <div className="field"><label htmlFor="img-h">Max height (px)</label><input id="img-h" type="number" min="1" inputMode="numeric" placeholder="Original" value={maxH} onChange={(e) => setMaxH(e.target.value)} /></div>
          </div>
          {(format === "image/jpeg" || (format === "auto" && items.some((i) => !EXT[i.file.type] || i.file.type === "image/jpeg"))) && (
            <div className="field">
              <label htmlFor="img-bg">Background for transparent areas (JPG)</label>
              <input id="img-bg" type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ padding: 4, height: 44 }} />
            </div>
          )}

          {done.length > 0 && (
            <div className="pstat" style={{ marginBottom: 14 }}>
              <div className="pcell"><div className="k">Before</div><div className="v">{formatBytes(before)}</div></div>
              <div className="pcell"><div className="k">After</div><div className="v gd">{formatBytes(after)}</div></div>
              <div className="pcell"><div className="k">Saved</div><div className="v">{before ? Math.round((1 - after / before) * 100) : 0}%</div></div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn pri" disabled={!done.length || busy} onClick={downloadAll}>
              {busy ? "Working…" : done.length > 1 ? `Download all (${done.length}) as .zip` : "Download"}
            </button>
            {items.length > 0 && <button className="btn gh" onClick={clear}>Clear</button>}
          </div>
          <div className="note i" style={{ marginTop: 14, marginBottom: 0 }}>
            <b>Privacy · </b>Images never leave your device. Saving also strips hidden metadata such as GPS location and camera details.
          </div>
        </div>
      </div>
    </div>
  );
}
