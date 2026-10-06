/* Pure image helpers — no DOM, so they run under node --test. */

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** Target size for a resize. mode "px" keeps aspect when `keep`; mode "pct" scales both. */
export function resizeDims(w, h, { mode, width, height, pct, keep }) {
  let nw = w, nh = h;
  if (mode === "pct") {
    const f = Math.max(1, Number(pct) || 100) / 100;
    nw = w * f; nh = h * f;
  } else {
    const tw = Number(width) || 0, th = Number(height) || 0;
    if (keep) {
      if (tw && th) { const f = Math.min(tw / w, th / h); nw = w * f; nh = h * f; }
      else if (tw) { nw = tw; nh = (h * tw) / w; }
      else if (th) { nh = th; nw = (w * th) / h; }
    } else { nw = tw || w; nh = th || h; }
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

/* ---- store-only ZIP (no compression: images are already compressed) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Uint8Array }] -> Uint8Array of a .zip archive. Duplicate names get " (n)". */
export function buildZip(files) {
  const enc = new TextEncoder();
  const seen = new Map();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    let name = f.name;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    const nameB = enc.encode(name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
