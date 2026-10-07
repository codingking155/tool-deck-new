import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { fmtBytes, resizeDims, fitMax, cropRect, outName, noopReason, compressMime } from "../lib/imageCore.mjs";
import { makeZip } from "../lib/zip.js";
import { ImagePlus, Loader2, Download, X, Columns2, Trash2, ClipboardPaste, Upload, ShieldCheck, ArrowRight, ArrowDown, ArrowUp,
  OctagonAlert, FileArchive, Shrink, Scaling, Crop, Repeat2, RotateCw, Stamp, SlidersHorizontal, Laugh, EyeOff } from "lucide-react";
import { Notice, StatusBadge, Metric } from "../components/ui.jsx";
import { Switch } from "../components/chrome.jsx";
import "./css/image.css";

/* Everything runs in the browser on <canvas>: files never leave the device. */

const MODES = [
  ["compress", "Compress"], ["resize", "Resize"], ["crop", "Crop"], ["convert", "Convert"],
  ["rotate", "Rotate & flip"], ["watermark", "Watermark"], ["editor", "Photo editor"],
  ["meme", "Meme"], ["blur", "Blur / redact"],
];

const DEFAULTS = {
  compress: { q: 70, fmt: "auto", max: "" },
  resize: { mode: "px", width: 1280, height: "", pct: 50, keep: true },
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
const RESIZE_PRESETS = [["Custom", "", ""], ["Instagram post 1080×1080", 1080, 1080], ["Story 1080×1920", 1080, 1920], ["HD 1280 wide", 1280, ""], ["Full HD 1920 wide", 1920, ""], ["Thumbnail 300 wide", 300, ""], ["Email 600 wide", 600, ""]];
const MAX_PIXELS = 100e6;
const QUALITY_PRESETS = [["Smallest", 40], ["Balanced", 70], ["High", 85], ["Best", 95]];
const isImageFile = (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|svg|avif)$/i.test(f.name);
const pct = (from, to) => (from ? Math.round((1 - to / from) * 100) : 0);

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
function ctx2d(c) {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error(`Image is too large to render on this device (${c.width}×${c.height}).`);
  return ctx;
}
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed."))), type, q));

function applyAdjust(ctx, w, h, o) {
  if (o.blur > 0) {
    /* shrink + re-enlarge: a cheap blur that works in every browser (ctx.filter doesn't in Safari) */
    const f = 1 / (1 + o.blur * 0.6);
    const small = mk(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f)));
    const sctx = ctx2d(small);
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
    for (let y = -h, row = 0; y < h * 2; y += stepY, row++) for (let x = -w; x < w * 2; x += stepX) ctx.fillText(text, x + (row % 2 ? stepX / 2 : 0), y);
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
      canvas = mk(w, h); ctx = ctx2d(canvas);
      /* GIF/BMP/SVG/AVIF can't be re-encoded as-is; "same as original" would mean a lossless
         PNG that is usually far BIGGER, so compress those to WebP where quality applies */
      mime = compressMime(o.fmt, file.type);
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
      q = o.q / 100;
    } else if (mode === "resize") {
      const { w, h } = resizeDims(sw, sh, o);
      canvas = mk(w, h); ctx = ctx2d(canvas);
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
    } else if (mode === "crop") {
      const r = cropRect(sw, sh, o);
      canvas = mk(r.w, r.h); ctx = ctx2d(canvas);
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    } else if (mode === "convert") {
      mime = o.to;
      if (mime === "image/avif" && !canAvif) throw new Error("This browser can't encode AVIF — try Chrome or Edge.");
      canvas = mk(sw, sh); ctx = ctx2d(canvas);
      if (mime === "image/jpeg") fillBg(ctx, o.bg);
      ctx.drawImage(bmp, 0, 0);
    } else if (mode === "rotate") {
      const swap = o.angle === 90 || o.angle === 270;
      canvas = mk(swap ? sh : sw, swap ? sw : sh); ctx = ctx2d(canvas);
      if (mime === "image/jpeg") fillBg(ctx, "#fff");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((o.angle * Math.PI) / 180);
      ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
      ctx.drawImage(bmp, -sw / 2, -sh / 2);
    } else {
      canvas = mk(sw, sh); ctx = ctx2d(canvas);
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
        ctx2d(small).drawImage(canvas, rx, ry, rw, rh, 0, 0, small.width, small.height);
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
    if (mode === "compress" && blob.size >= file.size) note = "Bigger than the original — try a lower quality or WebP";
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

const OP_ICON = { compress: Shrink, resize: Scaling, crop: Crop, convert: Repeat2, rotate: RotateCw,
  watermark: Stamp, editor: SlidersHorizontal, meme: Laugh, blur: EyeOff };
const OP_BLURB = {
  compress: "Shrink file size with adjustable quality.",
  resize: "Change dimensions by pixels, percentage or a preset.",
  crop: "Cut to an aspect ratio; drag the frame to position it.",
  convert: "Change format: JPG, PNG, WebP or AVIF.",
  rotate: "Turn by 90° steps or mirror the image.",
  watermark: "Stamp text on every image.",
  editor: "Brightness, contrast, colour and blur.",
  meme: "Classic top and bottom caption text.",
  blur: "Blur or pixelate one area — faces, plates, text.",
};
const modeLabel = (m) => MODES.find((x) => x[0] === m)[1];
/** "image/svg+xml" -> "SVG"; falls back to the file extension. */
function fmtOf(mime, name = "") {
  const t = (mime || "").split("/")[1];
  if (t) return t.replace("svg+xml", "svg").replace("jpeg", "jpg").replace("x-ms-bmp", "bmp").toUpperCase();
  const ext = /\.([a-z0-9]+)$/i.exec(name);
  return ext ? ext[1].toUpperCase() : "";
}

function Range({ id, label, value, min, max, step = 1, unit = "", onChange, scale }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className="field imgt-range">
      <label htmlFor={id} className="imgrange-l"><span>{label}</span><output htmlFor={id}>{value}{unit}</output></label>
      <input id={id} className="imgrange" type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ "--fill": fill }} />
      {scale && <div className="imgscale" aria-hidden="true"><span>{scale[0]}</span><span>{scale[1]}</span></div>}
    </div>
  );
}

function Toggle({ id, label, sub, on, onChange }) {
  return (
    <div className="tgl imgt-tgl">
      <div><div className="t" id={id}>{label}</div>{sub && <div className="s">{sub}</div>}</div>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}

/** A labelled group of settings inside the settings panel. */
function Group({ title, children }) {
  return (
    <fieldset className="imgt-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Options({ mode, o, set, canAvif, hasPng }) {
  if (mode === "compress") return <>
    <Group title="Quality">
      <Range id="oq" label="Quality" value={o.q} min={5} max={100} onChange={(v) => set("q", v)} scale={["Smaller file", "Better quality"]} />
      <div className="imgpresets" role="group" aria-label="Quality presets">
        {QUALITY_PRESETS.map(([l, v]) => <button key={l} type="button" aria-pressed={o.q === v} onClick={() => set("q", v)}>{l}<small>{v}</small></button>)}
      </div>
    </Group>
    <Group title="Output">
      <div className="two imgt-two32">
        <div className="field"><label htmlFor="ofmt">Format</label>
          <select id="ofmt" value={o.fmt} onChange={(e) => set("fmt", e.target.value)}>
            <option value="auto">Same as original</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option>
          </select></div>
        <div className="field"><label htmlFor="omax">Max side (px)</label>
          <input id="omax" type="number" min="1" placeholder="Optional" value={o.max} onChange={(e) => set("max", e.target.value)} aria-describedby="omax-h" /></div>
      </div>
      <div className="hint imgt-fieldhint" id="omax-h">Max side limits the longest edge, e.g. 1920.</div>
    </Group>
    {hasPng && o.fmt === "auto" && !Number(o.max) && <Notice tone="w" className="imgnote">PNG is lossless, so quality doesn't shrink it — switch the output to WebP or JPG (or set a max size) for big savings.</Notice>}
  </>;
  if (mode === "resize") return <>
    <Group title="Method">
      <div className="two">
        <div className="field"><label htmlFor="orm">Resize by</label>
          <select id="orm" value={o.mode} onChange={(e) => set("mode", e.target.value)}><option value="px">Pixels</option><option value="pct">Percentage</option></select></div>
        <div className="field"><label htmlFor="orp">Preset</label>
          <select id="orp" value="" onChange={(e) => { const p = RESIZE_PRESETS[Number(e.target.value)]; if (p) { set("mode", "px"); set("width", p[1]); set("height", p[2]); set("keep", true); } }}>
            {RESIZE_PRESETS.map((p, i) => <option key={p[0]} value={i === 0 ? "" : i}>{i === 0 ? "Choose…" : p[0]}</option>)}
          </select></div>
      </div>
    </Group>
    <Group title="Size">
      {o.mode === "pct" ? <Range id="opct" label="Scale" value={o.pct} min={1} max={200} unit="%" onChange={(v) => set("pct", v)} /> : <>
        <div className="two">
          <div className="field"><label htmlFor="orw">Width (px)</label><input id="orw" type="number" min="1" value={o.width} onChange={(e) => set("width", e.target.value)} /></div>
          <div className="field"><label htmlFor="orh">Height (px)</label><input id="orh" type="number" min="1" value={o.height} onChange={(e) => set("height", e.target.value)} /></div>
        </div>
        <Toggle id="okeep" label="Keep aspect ratio" sub="Fit inside the box instead of stretching" on={o.keep} onChange={(v) => set("keep", v)} />
        <div className="hint">Leave one box empty to size by the other. With both filled and aspect locked, the image fits inside the box.</div>
      </>}
    </Group>
  </>;
  if (mode === "crop") return <>
    <Group title="Frame">
      <div className="field"><label htmlFor="oca">Aspect ratio</label>
        <select id="oca" value={o.aspect} onChange={(e) => set("aspect", e.target.value)}>
          {["free", "1:1", "4:3", "3:2", "16:9", "9:16", "3:4"].map((a) => <option key={a} value={a}>{a === "free" ? "Original (zoom only)" : a}</option>)}
        </select></div>
      <Range id="ocz" label="Zoom" value={o.zoom} min={1} max={4} step={0.05} unit="×" onChange={(v) => set("zoom", v)} />
    </Group>
    <Group title="Position">
      <Range id="ocx" label="Horizontal" value={o.panX} min={0} max={100} unit="%" onChange={(v) => set("panX", v)} />
      <Range id="ocy" label="Vertical" value={o.panY} min={0} max={100} unit="%" onChange={(v) => set("panY", v)} />
    </Group>
  </>;
  if (mode === "convert") return <>
    <Group title="Output">
      <div className="field"><label htmlFor="oto">Convert to</label>
        <select id="oto" value={o.to} onChange={(e) => set("to", e.target.value)}>
          <option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option>
          {canAvif && <option value="image/avif">AVIF</option>}
        </select></div>
      {o.to === "image/jpeg" && <div className="field"><label htmlFor="obg">Background for transparency</label>
        <input id="obg" type="color" value={o.bg} onChange={(e) => set("bg", e.target.value)} /></div>}
      <div className="hint">Accepts anything your browser can open: JPG, PNG, WebP, GIF (first frame), BMP, SVG, AVIF. Also covers "JPG to PNG" and "PNG/GIF/SVG to JPG".</div>
    </Group>
  </>;
  if (mode === "rotate") return <>
    <Group title="Rotate">
      <div className="modes imgt-seg" role="group" aria-label="Rotate">
        {[0, 90, 180, 270].map((a) => <button key={a} type="button" aria-pressed={o.angle === a} className={o.angle === a ? "on" : ""} onClick={() => set("angle", a)}>{a}°</button>)}
      </div>
    </Group>
    <Group title="Flip">
      <Toggle id="ofh" label="Flip horizontally" on={o.flipH} onChange={(v) => set("flipH", v)} />
      <Toggle id="ofv" label="Flip vertically" on={o.flipV} onChange={(v) => set("flipV", v)} />
    </Group>
  </>;
  if (mode === "watermark") return <>
    <Group title="Text">
      <div className="field"><label htmlFor="owt">Watermark text</label><input id="owt" type="text" value={o.text} maxLength={80} onChange={(e) => set("text", e.target.value)} /></div>
    </Group>
    <Group title="Appearance">
      <Range id="ows" label="Size (% of width)" value={o.size} min={1} max={20} onChange={(v) => set("size", v)} />
      <Range id="owo" label="Opacity" value={o.opacity} min={5} max={100} unit="%" onChange={(v) => set("opacity", v)} />
      <div className="two">
        <div className="field"><label htmlFor="owp">Position</label>
          <select id="owp" value={o.pos} onChange={(e) => set("pos", e.target.value)}>
            {[["tl", "Top left"], ["tc", "Top centre"], ["tr", "Top right"], ["ml", "Middle left"], ["mc", "Centre"], ["mr", "Middle right"],
              ["bl", "Bottom left"], ["bc", "Bottom centre"], ["br", "Bottom right"], ["tile", "Tiled across image"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div className="field"><label htmlFor="owc">Colour</label><input id="owc" type="color" value={o.color} onChange={(e) => set("color", e.target.value)} /></div>
      </div>
    </Group>
  </>;
  if (mode === "editor") return <>
    <Group title="Light">
      <Range id="eb" label="Brightness" value={o.brightness} min={-100} max={100} onChange={(v) => set("brightness", v)} />
      <Range id="ec" label="Contrast" value={o.contrast} min={-100} max={100} onChange={(v) => set("contrast", v)} />
    </Group>
    <Group title="Colour">
      <Range id="es" label="Saturation" value={o.saturation} min={-100} max={100} onChange={(v) => set("saturation", v)} />
      <Range id="eg" label="Grayscale" value={o.grayscale} min={0} max={100} unit="%" onChange={(v) => set("grayscale", v)} />
      <Range id="ep" label="Sepia" value={o.sepia} min={0} max={100} unit="%" onChange={(v) => set("sepia", v)} />
    </Group>
    <Group title="Detail">
      <Range id="el" label="Blur" value={o.blur} min={0} max={20} onChange={(v) => set("blur", v)} />
    </Group>
  </>;
  if (mode === "meme") return <>
    <Group title="Captions">
      <div className="field"><label htmlFor="omt">Top text</label><input id="omt" type="text" value={o.top} maxLength={80} onChange={(e) => set("top", e.target.value)} /></div>
      <div className="field"><label htmlFor="omb">Bottom text</label><input id="omb" type="text" value={o.bottom} maxLength={80} onChange={(e) => set("bottom", e.target.value)} /></div>
    </Group>
  </>;
  if (mode === "blur") return <>
    <Group title="Effect">
      <div className="field"><label htmlFor="obs">Style</label>
        <select id="obs" value={o.style} onChange={(e) => set("style", e.target.value)}><option value="blur">Blur</option><option value="pixelate">Pixelate</option></select></div>
      <Range id="obt" label="Strength" value={o.strength} min={2} max={40} onChange={(v) => set("strength", v)} />
    </Group>
    <Group title="Area">
      <div className="two">
        <Range id="obx" label="Left" value={o.x} min={0} max={95} unit="%" onChange={(v) => set("x", v)} />
        <Range id="oby" label="Top" value={o.y} min={0} max={95} unit="%" onChange={(v) => set("y", v)} />
        <Range id="obw" label="Width" value={o.w} min={2} max={100} unit="%" onChange={(v) => set("w", v)} />
        <Range id="obh" label="Height" value={o.h} min={2} max={100} unit="%" onChange={(v) => set("h", v)} />
      </div>
      <div className="hint">Position the box over a face, plate or text — the same area is applied to every image. Manual only; no face detection is done.</div>
    </Group>
  </>;
  return null;
}

/** Live outline over the first image; drag it to move the crop window / blur box. */
function RegionPreview({ item, mode, o, set }) {
  const ref = useRef(null);
  const drag = useRef(null);
  if (mode !== "crop" && mode !== "blur") return null;
  if (!item) return <p className="hint imgt-regionhint">Add an image to position the {mode === "crop" ? "crop frame" : "blur box"} by dragging.</p>;
  const r = mode === "crop"
    ? (() => { const c = cropRect(item.w, item.h, o); return { l: (c.x / item.w) * 100, t: (c.y / item.h) * 100, w: (c.w / item.w) * 100, h: (c.h / item.h) * 100 }; })()
    : { l: o.x, t: o.y, w: Math.min(o.w, 100 - o.x), h: Math.min(o.h, 100 - o.y) };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, l: r.l, t: r.t, px: o.panX, py: o.panY }; };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const box = ref.current.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / box.width) * 100, dy = ((e.clientY - d.y) / box.height) * 100;
    if (mode === "blur") { set("x", Math.round(clamp(d.l + dx, 0, 100 - Math.min(o.w, 100)))); set("y", Math.round(clamp(d.t + dy, 0, 100 - Math.min(o.h, 100)))); }
    else {
      const freeX = 100 - r.w, freeY = 100 - r.h;
      if (freeX > 0) set("panX", Math.round(clamp(d.px + (dx / freeX) * 100, 0, 100)));
      if (freeY > 0) set("panY", Math.round(clamp(d.py + (dy / freeY) * 100, 0, 100)));
    }
  };
  return (
    <figure className="imgt-region">
      <div className="imgregion" ref={ref} style={{ aspectRatio: `${item.w} / ${item.h}` }}>
        <img src={item.src} alt="" draggable={false} />
        <div className="box" style={{ left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
      </div>
      <figcaption>Drag the {mode === "crop" ? "frame" : "box"} on {item.file.name} — or use the sliders.</figcaption>
    </figure>
  );
}

/** Before/after wipe: drag (or arrow-key) the handle to reveal the result over the original. */
function CompareSlider({ before, after, ratio, beforeLabel, afterLabel }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="imgwipe" style={{ aspectRatio: ratio, "--pos": `${pos}%` }}>
      <img src={before} alt="Original" draggable={false} />
      <img src={after} alt="Result" draggable={false} className="after" />
      <span className="tag l">{beforeLabel}</span><span className="tag r">{afterLabel}</span>
      <div className="handle" aria-hidden="true" />
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Reveal result" />
    </div>
  );
}

function FileRow({ item, solo, onRemove, onSave }) {
  const [cmp, setCmp] = useState(null);   // null = default: open when it's the only image
  const r = item.res;
  const saved = r ? pct(item.file.size, r.blob.size) : 0;
  const canCmp = r && r.blob !== item.file;
  const showCmp = canCmp && (cmp ?? solo);
  const inFmt = fmtOf(item.file.type, item.file.name), outFmt = r ? fmtOf(r.mime) : "";
  return (
    <li className={`imgrow${item.busy ? " busy" : ""}${item.err ? " err" : ""}${r ? " done" : ""}`}>
      <img className="th" src={r ? r.url : item.src} alt="" />
      <div className="meta">
        <b title={item.file.name}>{item.file.name}</b>
        <span className="sz">
          <span>{item.w}×{item.h}{inFmt && ` · ${inFmt}`} · {fmtBytes(item.file.size)}</span>
          {r && <><ArrowRight size={12} className="arr" aria-hidden="true" /><span className="sr-only"> becomes </span><span className="to">{r.w !== item.w || r.h !== item.h ? `${r.w}×${r.h} · ` : ""}{outFmt && outFmt !== inFmt ? `${outFmt} · ` : ""}{fmtBytes(r.blob.size)}</span></>}
        </span>
        {item.err && <span className="bad"><OctagonAlert size={12} aria-hidden="true" /> {item.err}</span>}
        {item.busy && <span className="wait"><Loader2 size={12} className="imgspin" aria-hidden="true" /> Processing…</span>}
        {r?.note && <span className="sub">{r.note}</span>}
      </div>
      {r && saved !== 0 && <span className="imgt-badge">
        <StatusBadge tone={saved > 0 ? "ok" : "bad"} icon={saved > 0 ? ArrowDown : ArrowUp}
          title={saved > 0 ? `${saved}% smaller than the original` : `${-saved}% larger than the original`}>
          {saved > 0 ? `${saved}% smaller` : `${-saved}% larger`}
        </StatusBadge></span>}
      <div className="act">
        {canCmp && <button type="button" className="btn gh ico" onClick={() => setCmp(!showCmp)} aria-pressed={!!showCmp} title="Compare before / after" aria-label={`Compare ${item.file.name}`}><Columns2 size={16} aria-hidden="true" /></button>}
        {r && <button type="button" className="btn gh ico" onClick={() => onSave(item)} title="Download" aria-label={`Download ${item.file.name}`}><Download size={16} aria-hidden="true" /></button>}
        <button type="button" className="btn gh ico" onClick={() => onRemove(item.id)} title="Remove" aria-label={`Remove ${item.file.name}`}><X size={16} aria-hidden="true" /></button>
      </div>
      {showCmp && <CompareSlider before={item.src} after={r.url} ratio={`${r.w} / ${r.h}`}
        beforeLabel={`Original · ${fmtBytes(item.file.size)}`} afterLabel={`Result · ${fmtBytes(r.blob.size)}`} />}
    </li>
  );
}

/** Picker: large and inviting when empty, a slim "add more" strip once there are files. */
function DropZone({ count, onFiles }) {
  const [drag, setDrag] = useState(false);
  const compact = count > 0;
  return (
    <label className={`imgdrop${drag ? " on" : ""}${compact ? " compact" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}>
      <input type="file" accept="image/*" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <span className="ic" aria-hidden="true">{compact ? <ImagePlus size={18} /> : <Upload size={26} />}</span>
      {compact ? <span className="tx">
        <span className="dsk"><b>Add more images</b> or drop them here</span>
        <span className="mob"><b>Add more images</b></span>
      </span> : <>
        <span className="tx">
          <span className="dsk"><b>Drop images</b> or <u>browse</u></span>
          <span className="mob"><b>Choose images</b></span>
        </span>
        <span className="sub">JPG · PNG · WebP · GIF · BMP · SVG · AVIF — up to {MAX_FILES} at once</span>
        <span className="sub priv"><ShieldCheck size={13} aria-hidden="true" /> Processed on this device — nothing uploads</span>
        <span className="sub paste dsk"><ClipboardPaste size={12} aria-hidden="true" /> or paste with <kbd className="k">Ctrl</kbd>/<kbd className="k">⌘</kbd>+<kbd className="k">V</kbd></span>
      </>}
      {drag && <span className="imgt-dropping" aria-hidden="true">Release to add</span>}
    </label>
  );
}

export default function ImageTool({ notify }) {
  const [mode, setMode] = useState("compress");
  const [opts, setOpts] = useState(DEFAULTS);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [prog, setProg] = useState(null);   // { done, total } while a batch runs
  const idRef = useRef(0);
  const runRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const canAvif = useMemo(() => {
    try { return document.createElement("canvas").toDataURL("image/avif").startsWith("data:image/avif"); } catch { return false; }
  }, []);

  useEffect(() => () => { runRef.current++; itemsRef.current.forEach((i) => { URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url); }); }, []);

  const setOpt = useCallback((k, v) => { setStale(true); setOpts((p) => ({ ...p, [mode]: { ...p[mode], [k]: v } })); }, [mode]);

  const clearResults = useCallback(() => setItems((arr) => arr.map((i) => {
    if (i.res?.url) URL.revokeObjectURL(i.res.url);
    return { ...i, res: null, err: null };
  })), []);
  const changeMode = (m) => { if (m !== mode && !busy) { setMode(m); clearResults(); setStale(false); } };

  const addFiles = useCallback(async (list) => {
    const files = [...list].filter(isImageFile);
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

  /* paste screenshots / copied images straight in (Ctrl/⌘+V anywhere on the tool page) */
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      addFiles(files.map((f, i) => (f.name && f.name !== "image.png" ? f
        : new File([f], `pasted-${Date.now()}${i ? `-${i}` : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const remove = useCallback((id) => setItems((arr) => arr.filter((i) => {
    if (i.id !== id) return true;
    URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url);
    return false;
  })), []);
  const clearAll = () => { runRef.current++; items.forEach((i) => { URL.revokeObjectURL(i.src); if (i.res?.url) URL.revokeObjectURL(i.res.url); }); setItems([]); setBusy(false); setProg(null); setStale(false); };

  const run = async () => {
    const token = ++runRef.current;
    const live = (id) => token === runRef.current && itemsRef.current.some((x) => x.id === id);
    setBusy(true); setStale(false);
    const o = opts[mode];
    const batch = itemsRef.current;
    let n = 0;
    setProg({ done: 0, total: batch.length });
    for (const it of batch) {
      if (token !== runRef.current) return;
      setProg({ done: n++, total: batch.length });
      if (!live(it.id)) continue;
      setItems((a) => a.map((x) => (x.id === it.id ? { ...x, busy: true, err: null } : x)));
      try {
        const res = await runMode(mode, o, it.file, canAvif);
        if (!live(it.id)) continue;
        const url = URL.createObjectURL(res.blob);
        setItems((a) => a.map((x) => {
          if (x.id !== it.id) { return x; }
          if (x.res?.url) URL.revokeObjectURL(x.res.url);
          return { ...x, busy: false, res: { ...res, url } };
        }));
      } catch (e) {
        if (live(it.id)) setItems((a) => a.map((x) => (x.id === it.id ? { ...x, busy: false, res: null, err: e.message || "Failed." } : x)));
      }
    }
    if (token === runRef.current) { setBusy(false); setProg(null); }
  };

  const saveOne = (it) => download(it.res.blob, outName(it.file.name, SUFFIX[mode], it.res.mime));
  const done = items.filter((i) => i.res);
  const saveZip = async () => {
    const files = await Promise.all(done.map(async (i) => ({ name: outName(i.file.name, SUFFIX[mode], i.res.mime), data: new Uint8Array(await i.res.blob.arrayBuffer()) })));
    download(new Blob([makeZip(files)], { type: "application/zip" }), "tooldeck-images.zip");
    notify(`Zipped ${files.length} image${files.length > 1 ? "s" : ""}.`);
  };

  const why = noopReason(mode, opts[mode]);
  const GIF = items.some((i) => i.file.type === "image/gif");
  const hasPng = items.some((i) => i.file.type === "image/png");
  const failed = items.filter((i) => i.err).length;
  const totalIn = done.reduce((s, i) => s + i.file.size, 0), totalOut = done.reduce((s, i) => s + i.res.blob.size, 0);
  const label = modeLabel(mode);
  const OpIcon = OP_ICON[mode];
  const current = prog ? Math.min(prog.done + 1, prog.total) : 0;

  return (
    <div className="imgt">
      <div className="imgt-drop"><DropZone count={items.length} onFiles={addFiles} /></div>

      <section className="panel imgt-ops" aria-labelledby="imgt-ops-h">
        <div className="pb">
          <h2 className="imgt-eyebrow" id="imgt-ops-h">Operation</h2>
          <div className="imgmodes" role="group" aria-label="Image tool">
            {MODES.map(([id, l]) => {
              const Ic = OP_ICON[id];
              return (
                <button key={id} type="button" aria-pressed={mode === id} disabled={busy && mode !== id} className={mode === id ? "on" : ""} onClick={() => changeMode(id)}>
                  <Ic size={18} aria-hidden="true" strokeWidth={1.9} /><span>{l}</span>
                </button>
              );
            })}
          </div>

          <div className="imgt-settings">
            <div className="imgt-sethead">
              <span className="ic" aria-hidden="true"><OpIcon size={16} /></span>
              <div><h3>{label} settings</h3><p>{OP_BLURB[mode]} Applied to every image.</p></div>
            </div>
            <Options mode={mode} o={opts[mode]} set={setOpt} canAvif={canAvif} hasPng={hasPng} />
            <RegionPreview item={items[0]} mode={mode} o={opts[mode]} set={setOpt} />
            {GIF && <div className="hint">GIF animation isn't kept — only the first frame is processed.</div>}
          </div>

          <div className="imgt-run">
            {stale && done.length > 0 && <Notice tone="w" className="imgnote">Options changed — results are outdated. Apply again to refresh.</Notice>}
            {why && items.length > 0 && <div className="hint imgt-why">{why}</div>}
            <button type="button" className="btn pri imgapply" disabled={!items.length || busy || !!why} onClick={run} aria-describedby={prog ? "imgprog" : undefined}>
              {busy ? <><Loader2 size={17} className="imgspin" aria-hidden="true" /> Working… {prog ? `${current}/${prog.total}` : ""}</>
                : items.length ? <><OpIcon size={17} aria-hidden="true" /> {`${label} ${items.length} image${items.length > 1 ? "s" : ""}`}</> : "Add images to start"}
            </button>
          </div>
        </div>
      </section>

      <section className="imgt-assets" aria-label="Images">
        {items.length === 0 ? (
          <p className="hint imgnot">
            <b>Not included:</b> background removal, AI upscaling, HEIC input and HTML-to-image need server-side or heavy AI processing, so they aren't part of this private, in-browser tool.
          </p>
        ) : (
          <div className="panel">
            <div className="ph imgph">
              <h2>Images <span className="imgcount" aria-label={`${items.length} of ${MAX_FILES} maximum`}>{items.length}/{MAX_FILES}</span></h2>
              <button type="button" className="btn gh sm auto imgclear" onClick={clearAll}><Trash2 size={15} aria-hidden="true" /> Clear all</button>
            </div>
            <div className="pb">
              <div className="imgt-status" aria-live="polite">
                {prog && <div className="imgt-prog">
                  <div className="imgt-progtx"><span><Loader2 size={13} className="imgspin" aria-hidden="true" /> Processing {current} of {prog.total}</span><span className="pc">{Math.round((prog.done / Math.max(prog.total, 1)) * 100)}%</span></div>
                  <div id="imgprog" className="prog" role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done} aria-valuetext={`${prog.done} of ${prog.total} done`}>
                    <i style={{ width: `${(prog.done / Math.max(prog.total, 1)) * 100}%` }} />
                  </div>
                </div>}
                {!prog && done.length > 0 && <div className="metrics imgsum">
                  <Metric label="Processed" value={`${done.length}/${items.length}`} />
                  <Metric label="Original" value={fmtBytes(totalIn)} />
                  <Metric label="Output" value={fmtBytes(totalOut)} />
                  <Metric label={totalOut <= totalIn ? "Saved" : "Grew"} value={`${totalOut <= totalIn ? "↓" : "↑"} ${Math.abs(pct(totalIn, totalOut))}%`} tone={totalOut <= totalIn ? "good" : "bad"} />
                </div>}
              </div>
              {failed > 0 && <Notice tone="e" className="imgnote">{failed} image{failed > 1 ? "s" : ""} failed — see the list below.</Notice>}
              <ul className="imglist" aria-label="Selected images">
                {items.map((it) => <FileRow key={it.id} item={it} solo={items.length === 1} onRemove={remove} onSave={saveOne} />)}
              </ul>
            </div>
            {done.length > 0 && <div className="imgbar">
              <p className="imgt-exptx">
                <b>{done.length} {done.length > 1 ? "images" : "image"} ready</b>
                <span>{fmtBytes(totalOut)}{done.length > 1 ? " · one .zip file" : ""}</span>
              </p>
              {done.length > 1
                ? <button type="button" className="btn pri auto" onClick={saveZip}><FileArchive size={16} aria-hidden="true" /> Download all as ZIP</button>
                : <button type="button" className="btn pri auto" onClick={() => saveOne(done[0])}><Download size={16} aria-hidden="true" /> Download</button>}
            </div>}
          </div>
        )}
      </section>
    </div>
  );
}
