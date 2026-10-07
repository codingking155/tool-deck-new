/* Pure image helpers — no DOM, so they run under node --test. */

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** Target size for a resize. mode "px": both boxes filled -> fit inside when `keep`, else stretch to exactly that;
    one box filled -> the other scales proportionally (never stretched). mode "pct" scales both. */
export function resizeDims(w, h, { mode, width, height, pct, keep }) {
  let nw = w, nh = h;
  if (mode === "pct") {
    const f = Math.max(1, Number(pct) || 100) / 100;
    nw = w * f; nh = h * f;
  } else {
    const tw = Number(width) || 0, th = Number(height) || 0;
    if (tw && th) {
      if (keep) { const f = Math.min(tw / w, th / h); nw = w * f; nh = h * f; } else { nw = tw; nh = th; }
    } else if (tw) { nw = tw; nh = (h * tw) / w; }
    else if (th) { nh = th; nw = (w * th) / h; }
  }
  return { w: Math.max(1, Math.round(nw)), h: Math.max(1, Math.round(nh)) };
}

/** Scale down so the longest side is <= max (0/blank = no limit). Never upscales. */
export function fitMax(w, h, max) {
  const m = Number(max) || 0;
  if (!m || (w <= m && h <= m)) return { w, h };
  const f = m / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
}

/** Crop rectangle: aspect "free" | "w:h", zoom >= 1, pan 0..100 on each axis. */
export function cropRect(w, h, { aspect, zoom, panX, panY }) {
  let cw = w, ch = h;
  if (aspect && aspect !== "free") {
    const [a, b] = aspect.split(":").map(Number);
    const r = a / b;
    if (w / h > r) cw = h * r; else ch = w / r;
  }
  const z = Math.max(1, Number(zoom) || 1);
  cw /= z; ch /= z;
  const pan = (p) => (Number.isFinite(Number(p)) ? Math.min(100, Math.max(0, Number(p))) : 50);
  const x = ((w - cw) * pan(panX)) / 100;
  const y = ((h - ch) * pan(panY)) / 100;
  return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(cw)), h: Math.max(1, Math.round(ch)) };
}

export const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

export function outName(name, suffix, mime) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  const ext = MIME_EXT[mime] || (name.match(/\.([^.]+)$/)?.[1] ?? "img");
  return `${base}${suffix}.${ext}`;
}

/** Why Apply is pointless right now, or "" when it will change something. */
export function noopReason(mode, o) {
  if (mode === "resize" && o.mode === "px" && !Number(o.width) && !Number(o.height)) return "Enter a width or height.";
  if (mode === "editor" && !Object.values(o).some(Boolean)) return "Move a slider to adjust the photo.";
  if (mode === "watermark" && !o.text.trim()) return "Enter watermark text.";
  if (mode === "meme" && !o.top.trim() && !o.bottom.trim()) return "Enter top or bottom text.";
  if (mode === "rotate" && !o.angle && !o.flipH && !o.flipV) return "Pick a rotation or a flip.";
  if (mode === "crop" && o.aspect === "free" && Number(o.zoom) <= 1) return "Pick an aspect ratio or zoom in to crop.";
  return "";
}

/** Compress output type: "auto" keeps JPG/PNG/WebP; other inputs (GIF/BMP/SVG/AVIF) go to WebP,
    since re-encoding them "as-is" means a lossless, usually larger PNG. */
export function compressMime(fmt, srcType) {
  if (fmt && fmt !== "auto") return fmt;
  return ["image/jpeg", "image/png", "image/webp"].includes(srcType) ? srcType : "image/webp";
}
