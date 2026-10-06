import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { fmtBytes, resizeDims, fitMax, cropRect, outName, buildZip } from "../lib/imageCore.mjs";

/* Everything runs in the browser on <canvas>: files never leave the device. */

const MODES = [
  ["compress", "Compress"], ["resize", "Resize"], ["crop", "Crop"], ["convert", "Convert"],
  ["rotate", "Rotate & flip"], ["watermark", "Watermark"], ["editor", "Photo editor"],
  ["meme", "Meme"], ["blur", "Blur / redact"],
];

const DEFAULTS = {
  compress: { q: 70, fmt: "auto", max: "" },
  resize: { mode: "px", width: "", height: "", pct: 50, keep: true },
  crop: { aspect: "1:1", zoom: 1, panX: 50, panY: 50 },
  convert: { to: "image/jpeg", bg: "#ffffff" },
  rotate: { angle: 90, flipH: false, flipV: false },
  watermark: { text: "© ToolDeck", size: 5, opacity: 50, pos: "br", color: "#ffffff" },
  editor: { brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, blur: 0 },
  meme: { top: "WHEN THE IMAGE", bottom: "FINALLY COMPRESSES" },
  blur: { x: 30, y: 30, w: 40, h: 25, style: "blur", strength: 12 },
};

const SUFFIX = { compress: "-compressed", resize: "-resized", crop: "-cropped", convert: "-converted", rotate: "-rotated",
  watermark: "-watermarked", editor: "-edited", meme: "-meme", blur: "-blurred" };
const MAX_FILES = 40;
const MAX_PIXELS = 100e6;

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function" && file.type !== "image/svg+xml") {
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    if (!im.naturalWidth || !im.naturalHeight) throw new Error("unreadable");
    return im;
  } catch { throw new Error("This file couldn't be decoded as an image."); }
  finally { URL.revokeObjectURL(url); }
}
const dimOf = (b) => ({ w: b.naturalWidth || b.width, h: b.naturalHeight || b.height });

function mk(w, h) {
  if (w * h > MAX_PIXELS) throw new Error(`Image is too large to process in the browser (${w}×${h}).`);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed."))), type, q));

function applyAdjust(ctx, w, h, o) {
  if (o.blur > 0) {
    /* shrink + re-enlarge: a cheap blur that works in every browser (ctx.filter doesn't in Safari) */
    const f = 1 / (1 + o.blur * 0.6);
    const small = mk(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f)));
    const sctx = small.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(ctx.canvas, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(small, 0, 0, w, h);
  }
  if (!(o.brightness || o.contrast || o.saturation || o.grayscale || o.sepia)) return;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const bf = 1 + o.brightness / 100, cf = 1 + o.contrast / 100, sf = 1 + o.saturation / 100;
  const gs = o.grayscale / 100, sp = o.sepia / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * bf, g = d[i + 1] * bf, b = d[i + 2] * bf;
    r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; b = (b - 128) * cf + 128;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * sf; g = l + (g - l) * sf; b = l + (b - l) * sf;
    if (gs) { r += (l - r) * gs; g += (l - g) * gs; b += (l - b) * gs; }
    if (sp) {
      const tr = 0.393 * r + 0.769 * g + 0.189 * b, tg = 0.349 * r + 0.686 * g + 0.168 * b, tb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (tr - r) * sp; g += (tg - g) * sp; b += (tb - b) * sp;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; /* Uint8ClampedArray clamps */
  }
  ctx.putImageData(img, 0, 0);
}

function drawMemeText(ctx, text, w, h, top) {
  const t = text.trim().toUpperCase();
  if (!t) return;
  let size = Math.round(w / 9);
  ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  while (ctx.measureText(t).width > w * 0.94 && size > 10) { size -= 2; ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`; }
  ctx.textAlign = "center"; ctx.textBaseline = top ? "top" : "bottom";
  ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = "#000"; ctx.fillStyle = "#fff";
  const y = top ? h * 0.03 : h * 0.97;
  ctx.strokeText(t, w / 2, y); ctx.fillText(t, w / 2, y);
}

function drawWatermark(ctx, w, h, o) {
  const size = Math.max(8, Math.round((w * o.size) / 100));
  ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.globalAlpha = o.opacity / 100;
  ctx.fillStyle = o.color;
  ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = size / 8;
  const text = o.text || "";
  if (!text) return;
  if (o.pos === "tile") {
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const stepX = ctx.measureText(text).width + size * 2, stepY = size * 3.2;
    ctx.save(); ctx.rotate(-Math.PI / 8);
    for (let y = -h; y < h * 2; y += stepY) for (let x = -w; x < w * 2; x += stepX) ctx.fillText(text, x + ((y / stepY) % 2 ? stepX / 2 : 0), y);
    ctx.restore();
  } else {
    const pad = size * 0.8;
    const [v, hz] = [o.pos[0], o.pos[1]];
    ctx.textBaseline = v === "t" ? "top" : v === "m" ? "middle" : "bottom";
    ctx.textAlign = hz === "l" ? "left" : hz === "c" ? "center" : "right";
    ctx.fillText(text, hz === "l" ? pad : hz === "c" ? w / 2 : w - pad, v === "t" ? pad : v === "m" ? h / 2 : h - pad);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}

/** Runs one mode on one file -> { blob, w, h, note? } */
async function runMode(mode, o, file, canAvif) {
  const bmp = await loadBitmap(file);
  const { w: sw, h: sh } = dimOf(bmp);
  const srcMime = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : "image/png";
  let mime = srcMime, q = 0.92, canvas, ctx, note;
  const fillBg = (c, color) => { c.fillStyle = color; c.fillRect(0, 0, c.canvas.width, c.canvas.height); };
  try {
    if (mode === "compress") {
      const { w, h } = fitMax(sw, sh, o.max);
      canvas = mk(w, h); ctx = canvas.getContext("2d");
      mime = o.fmt === "auto" ? srcMime : o.fmt;
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
      q = o.q / 100;
    } else if (mode === "resize") {
      const { w, h } = resizeDims(sw, sh, o);
      canvas = mk(w, h); ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
    } else if (mode === "crop") {
      const r = cropRect(sw, sh, o);
      canvas = mk(r.w, r.h); ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    } else if (mode === "convert") {
      mime = o.to;
      if (mime === "image/avif" && !canAvif) throw new Error("This browser can't encode AVIF — try Chrome or Edge.");
      canvas = mk(sw, sh); ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") fillBg(ctx, o.bg);
      ctx.drawImage(bmp, 0, 0);
    } else if (mode === "rotate") {
      const swap = o.angle === 90 || o.angle === 270;
      canvas = mk(swap ? sh : sw, swap ? sw : sh); ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((o.angle * Math.PI) / 180);
      ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
      ctx.drawImage(bmp, -sw / 2, -sh / 2);
    } else {
      canvas = mk(sw, sh); ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.drawImage(bmp, 0, 0);
      if (mode === "watermark") drawWatermark(ctx, sw, sh, o);
      else if (mode === "editor") applyAdjust(ctx, sw, sh, o);
      else if (mode === "meme") { drawMemeText(ctx, o.top, sw, sh, true); drawMemeText(ctx, o.bottom, sw, sh, false); }
      else if (mode === "blur") {
        const rx = Math.round((o.x / 100) * sw), ry = Math.round((o.y / 100) * sh);
        const rw = Math.max(1, Math.min(sw - rx, Math.round((o.w / 100) * sw))), rh = Math.max(1, Math.min(sh - ry, Math.round((o.h / 100) * sh)));
        const f = 1 / Math.max(2, o.strength * (o.style === "pixelate" ? 1.5 : 1));
        const small = mk(Math.max(1, Math.round(rw * f)), Math.max(1, Math.round(rh * f)));
        small.getContext("2d").drawImage(canvas, rx, ry, rw, rh, 0, 0, small.width, small.height);
        ctx.save(); ctx.imageSmoothingEnabled = o.style !== "pixelate"; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(small, 0, 0, small.width, small.height, rx, ry, rw, rh);
        ctx.restore();
      }
    }
    const blob = await toBlob(canvas, mime, q);
    if (blob.type !== mime) throw new Error(`This browser can't encode ${mime.replace("image/", "").toUpperCase()}.`);
    if (mode === "compress" && blob.size >= file.size && mime === file.type && canvas.width === sw && canvas.height === sh) {
      return { blob: file, w: sw, h: sh, mime, note: "Already optimal — original kept" };
    }
    return { blob, w: canvas.width, h: canvas.height, mime, note };
  } finally { bmp.close?.(); }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---- option panels (module scope — the app re-renders every second) ---- */

function Range({ id, label, value, min, max, step = 1, unit = "", onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label} · {value}{unit}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ padding: 0 }} />
    </div>
  );
}

function Check({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="imgcheck"><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
  );
}

function Options({ mode, o, set, canAvif }) {
  if (mode === "compress") return <>
    <Range id="oq" label="Quality" value={o.q} min={5} max={100} onChange={(v) => set("q", v)} />
    <div className="field"><label htmlFor="ofmt">Output format</label>
      <select id="ofmt" value={o.fmt} onChange={(e) => set("fmt", e.target.value)}>
        <option value="auto">Same as original</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option>
      </select></div>
    <div className="field"><label htmlFor="omax">Max width/height (px, optional)</label>
      <input id="omax" type="number" min="1" placeholder="e.g. 1920" value={o.max} onChange={(e) => set("max", e.target.value)} /></div>
    <div className="hint">PNG is lossless, so quality doesn't shrink it — switch the output to WebP or JPG (or set a max size) for big savings.</div>
  </>;
  if (mode === "resize") return <>
    <div className="field"><label htmlFor="orm">Resize by</label>
      <select id="orm" value={o.mode} onChange={(e) => set("mode", e.target.value)}><option value="px">Pixels</option><option value="pct">Percentage</option></select></div>
    {o.mode === "pct" ? <Range id="opct" label="Scale" value={o.pct} min={1} max={200} unit="%" onChange={(v) => set("pct", v)} /> : <>
      <div className="field"><label htmlFor="orw">Width (px)</label><input id="orw" type="number" min="1" value={o.width} onChange={(e) => set("width", e.target.value)} /></div>
      <div className="field"><label htmlFor="orh">Height (px)</label><input id="orh" type="number" min="1" value={o.height} onChange={(e) => set("height", e.target.value)} /></div>
      <Check id="okeep" label="Keep aspect ratio" checked={o.keep} onChange={(v) => set("keep", v)} />
      <div className="hint">Leave one box empty to size by the other. With both filled and aspect locked, the image fits inside the box.</div>
    </>}
  </>;
  if (mode === "crop") return <>
    <div className="field"><label htmlFor="oca">Aspect ratio</label>
      <select id="oca" value={o.aspect} onChange={(e) => set("aspect", e.target.value)}>
        {["free", "1:1", "4:3", "3:2", "16:9", "9:16", "3:4"].map((a) => <option key={a} value={a}>{a === "free" ? "Original (zoom only)" : a}</option>)}
      </select></div>
    <Range id="ocz" label="Zoom" value={o.zoom} min={1} max={4} step={0.05} unit="×" onChange={(v) => set("zoom", v)} />
    <Range id="ocx" label="Position ←→" value={o.panX} min={0} max={100} unit="%" onChange={(v) => set("panX", v)} />
    <Range id="ocy" label="Position ↑↓" value={o.panY} min={0} max={100} unit="%" onChange={(v) => set("panY", v)} />
  </>;
  if (mode === "convert") return <>
    <div className="field"><label htmlFor="oto">Convert to</label>
      <select id="oto" value={o.to} onChange={(e) => set("to", e.target.value)}>
        <option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option>
        {canAvif && <option value="image/avif">AVIF</option>}
      </select></div>
    {o.to === "image/jpeg" && <div className="field"><label htmlFor="obg">Background for transparency</label>
      <input id="obg" type="color" value={o.bg} onChange={(e) => set("bg", e.target.value)} style={{ padding: 4 }} /></div>}
    <div className="hint">Accepts anything your browser can open: JPG, PNG, WebP, GIF (first frame), BMP, SVG, AVIF. Also covers "JPG to PNG" and "PNG/GIF/SVG to JPG".</div>
  </>;
  if (mode === "rotate") return <>
    <div className="field"><label>Rotate</label>
      <div className="modes" style={{ marginBottom: 0 }}>
        {[0, 90, 180, 270].map((a) => <button key={a} className={o.angle === a ? "on" : ""} onClick={() => set("angle", a)}>{a}°</button>)}
      </div></div>
    <Check id="ofh" label="Flip horizontally" checked={o.flipH} onChange={(v) => set("flipH", v)} />
    <Check id="ofv" label="Flip vertically" checked={o.flipV} onChange={(v) => set("flipV", v)} />
  </>;
  if (mode === "watermark") return <>
    <div className="field"><label htmlFor="owt">Text</label><input id="owt" type="text" value={o.text} maxLength={80} onChange={(e) => set("text", e.target.value)} /></div>
    <Range id="ows" label="Size (% of width)" value={o.size} min={1} max={20} onChange={(v) => set("size", v)} />
    <Range id="owo" label="Opacity" value={o.opacity} min={5} max={100} unit="%" onChange={(v) => set("opacity", v)} />
    <div className="field"><label htmlFor="owp">Position</label>
      <select id="owp" value={o.pos} onChange={(e) => set("pos", e.target.value)}>
        {[["tl", "Top left"], ["tc", "Top centre"], ["tr", "Top right"], ["ml", "Middle left"], ["mc", "Centre"], ["mr", "Middle right"],
          ["bl", "Bottom left"], ["bc", "Bottom centre"], ["br", "Bottom right"], ["tile", "Tiled across image"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></div>
    <div className="field"><label htmlFor="owc">Colour</label><input id="owc" type="color" value={o.color} onChange={(e) => set("color", e.target.value)} style={{ padding: 4 }} /></div>
  </>;
  if (mode === "editor") return <>
    <Range id="eb" label="Brightness" value={o.brightness} min={-100} max={100} onChange={(v) => set("brightness", v)} />
    <Range id="ec" label="Contrast" value={o.contrast} min={-100} max={100} onChange={(v) => set("contrast", v)} />
    <Range id="es" label="Saturation" value={o.saturation} min={-100} max={100} onChange={(v) => set("saturation", v)} />
    <Range id="eg" label="Grayscale" value={o.grayscale} min={0} max={100} unit="%" onChange={(v) => set("grayscale", v)} />
    <Range id="ep" label="Sepia" value={o.sepia} min={0} max={100} unit="%" onChange={(v) => set("sepia", v)} />
    <Range id="el" label="Blur" value={o.blur} min={0} max={20} onChange={(v) => set("blur", v)} />
  </>;
  if (mode === "meme") return <>
    <div className="field"><label htmlFor="omt">Top text</label><input id="omt" type="text" value={o.top} maxLength={80} onChange={(e) => set("top", e.target.value)} /></div>
    <div className="field"><label htmlFor="omb">Bottom text</label><input id="omb" type="text" value={o.bottom} maxLength={80} onChange={(e) => set("bottom", e.target.value)} /></div>
  </>;
  if (mode === "blur") return <>
    <div className="field"><label htmlFor="obs">Style</label>
      <select id="obs" value={o.style} onChange={(e) => set("style", e.target.value)}><option value="blur">Blur</option><option value="pixelate">Pixelate</option></select></div>
    <Range id="obx" label="Left" value={o.x} min={0} max={95} unit="%" onChange={(v) => set("x", v)} />
    <Range id="oby" label="Top" value={o.y} min={0} max={95} unit="%" onChange={(v) => set("y", v)} />
    <Range id="obw" label="Width" value={o.w} min={2} max={100} unit="%" onChange={(v) => set("w", v)} />
    <Range id="obh" label="Height" value={o.h} min={2} max={100} unit="%" onChange={(v) => set("h", v)} />
    <Range id="obt" label="Strength" value={o.strength} min={2} max={40} onChange={(v) => set("strength", v)} />
    <div className="hint">Position the box over a face, plate or text — the same area is applied to every image. Manual only; no face detection is done.</div>
  </>;
  return null;
}

/** Live outline over the first image for the modes that pick a region. */
function RegionPreview({ item, mode, o }) {
  if (!item || (mode !== "crop" && mode !== "blur")) return null;
  const r = mode === "crop"
    ? (() => { const c = cropRect(item.w, item.h, o); return { l: (c.x / item.w) * 100, t: (c.y / item.h) * 100, w: (c.w / item.w) * 100, h: (c.h / item.h) * 100 }; })()
    : { l: o.x, t: o.y, w: Math.min(o.w, 100 - o.x), h: Math.min(o.h, 100 - o.y) };
  return (
    <div className="imgregion" style={{ aspectRatio: `${item.w} / ${item.h}` }}>
      <img src={item.src} alt="" />
      <div className="box" style={{ left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` }} />
    </div>
  );
}

function FileRow({ item, onRemove, onSave }) {
  const r = item.res;
  const saved = r ? Math.round((1 - r.blob.size / item.file.size) * 100) : 0;
  return (
    <div className="imgrow">
      <img className="th" src={item.src} alt="" />
      <div className="meta">
        <b title={item.file.name}>{item.file.name}</b>
        <span>{item.w}×{item.h} · {fmtBytes(item.file.size)}</span>
        {item.err && <span style={{ color: "var(--bad)" }}>{item.err}</span>}
        {item.busy && <span style={{ color: "var(--tx3)" }}>Processing…</span>}
        {r && <span style={{ color: "var(--good)" }}>
          → {r.w}×{r.h} · {fmtBytes(r.blob.size)}{saved > 0 ? ` · −${saved}%` : saved < 0 ? ` · +${-saved}%` : ""}{r.note ? ` · ${r.note}` : ""}
        </span>}
      </div>
      {r && <img className="th" src={r.url} alt="Result" />}
      <div className="act">
        {r && <button className="btn gh" onClick={() => onSave(item)}>Download</button>}
        <button className="btn gh" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.file.name}`}>✕</button>
      </div>
    </div>
  );
}

export default function ImageTool({ notify }) {
  const [mode, setMode] = useState("compress");
  const [opts, setOpts] = useState(DEFAULTS);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const idRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const canAvif = useMemo(() => {
    try { return document.createElement("canvas").toDataURL("image/avif").startsWith("data:image/avif"); } catch { return false; }
  }, []);

  useEffect(() => () => itemsRef.current.forEach((i) => { URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url); }), []);

  const setOpt = useCallback((k, v) => setOpts((p) => ({ ...p, [mode]: { ...p[mode], [k]: v } })), [mode]);

  const clearResults = useCallback(() => setItems((arr) => arr.map((i) => {
    if (i.res?.url) URL.revokeObjectURL(i.res.url);
    return { ...i, res: null, err: null };
  })), []);
  const changeMode = (m) => { if (m !== mode) { setMode(m); clearResults(); } };

  const addFiles = useCallback(async (list) => {
    const files = [...list].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|svg|avif)$/i.test(f.name));
    if (!files.length) { notify("Choose image files (JPG, PNG, WebP, GIF, BMP, SVG, AVIF)."); return; }
    const room = MAX_FILES - itemsRef.current.length;
    if (files.length > room) notify(`Up to ${MAX_FILES} images at a time — added the first ${Math.max(room, 0)}.`);
    for (const file of files.slice(0, Math.max(room, 0))) {
      const id = ++idRef.current, src = URL.createObjectURL(file);
      try {
        const b = await loadBitmap(file);
        const { w, h } = dimOf(b); b.close?.();
        setItems((a) => [...a, { id, file, src, w, h }]);
      } catch (e) {
        URL.revokeObjectURL(src);
        notify(`${file.name}: ${e.message}`);
      }
    }
  }, [notify]);

  const remove = useCallback((id) => setItems((arr) => arr.filter((i) => {
    if (i.id !== id) return true;
    URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url);
    return false;
  })), []);
  const clearAll = () => { items.forEach((i) => { URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url); }); setItems([]); };

  const run = async () => {
    setBusy(true);
    const o = opts[mode];
    for (const it of itemsRef.current) {
      setItems((a) => a.map((x) => (x.id === it.id ? { ...x, busy: true, err: null } : x)));
      try {
        const res = await runMode(mode, o, it.file, canAvif);
        const url = URL.createObjectURL(res.blob);
        setItems((a) => a.map((x) => {
          if (x.id !== it.id) { return x; }
          if (x.res?.url) URL.revokeObjectURL(x.res.url);
          return { ...x, busy: false, res: { ...res, url } };
        }));
      } catch (e) {
        setItems((a) => a.map((x) => (x.id === it.id ? { ...x, busy: false, res: null, err: e.message || "Failed." } : x)));
      }
    }
    setBusy(false);
  };

  const saveOne = (it) => download(it.res.blob, outName(it.file.name, SUFFIX[mode], it.res.mime));
  const done = items.filter((i) => i.res);
  const saveZip = async () => {
    const files = await Promise.all(done.map(async (i) => ({ name: outName(i.file.name, SUFFIX[mode], i.res.mime), data: new Uint8Array(await i.res.blob.arrayBuffer()) })));
    download(new Blob([buildZip(files)], { type: "application/zip" }), "tooldeck-images.zip");
    notify(`Zipped ${files.length} image${files.length > 1 ? "s" : ""}.`);
  };

  const totalIn = done.reduce((s, i) => s + i.file.size, 0), totalOut = done.reduce((s, i) => s + i.res.blob.size, 0);

  return (
    <div>
      <div className="modes" role="tablist">
        {MODES.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => changeMode(id)}>{label}</button>
        ))}
      </div>
      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h3>{MODES.find((m) => m[0] === mode)[1]} options</h3><p>Applied to every image in the list.</p></div>
          <div className="pb">
            <Options mode={mode} o={opts[mode]} set={setOpt} canAvif={canAvif} />
            <RegionPreview item={items[0]} mode={mode} o={opts[mode]} />
            <button className="btn pri" style={{ marginTop: 12 }} disabled={!items.length || busy} onClick={run}>
              {busy ? "Working…" : items.length ? `Apply to ${items.length} image${items.length > 1 ? "s" : ""}` : "Add images first"}
            </button>
          </div>
        </div>
        <div className="panel rise d2">
          <div className="ph"><h3>Images</h3><p>Processed locally in your browser — nothing is uploaded.</p></div>
          <div className="pb">
            <label className={`imgdrop ${drag ? "on" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
              <input type="file" accept="image/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <b>Select images</b> or drop them here
              <span>JPG · PNG · WebP · GIF · BMP · SVG · AVIF — up to {MAX_FILES}</span>
            </label>
            {items.length > 0 && <>
              <div className="imglist">
                {items.map((it) => <FileRow key={it.id} item={it} onRemove={remove} onSave={saveOne} />)}
              </div>
              <div className="imgbar">
                {done.length > 0 && <span className="hint" style={{ margin: 0 }}>
                  {done.length} done · {fmtBytes(totalIn)} → {fmtBytes(totalOut)}
                </span>}
                <span style={{ flex: 1 }} />
                {done.length > 1 && <button className="btn gh" onClick={saveZip}>Download all (.zip)</button>}
                {done.length === 1 && <button className="btn gh" onClick={() => saveOne(done[0])}>Download</button>}
                <button className="btn gh" onClick={clearAll}>Clear</button>
              </div>
            </>}
            {!items.length && <div className="note i" style={{ marginTop: 14, marginBottom: 0 }}>
              <b>Not included · </b>background removal, AI upscaling, HEIC input and HTML-to-image need server-side or heavy AI processing, so they aren't part of this private, in-browser tool.
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
