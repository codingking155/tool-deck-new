/* Pure PDF operations (pdf-lib). Everything runs in the browser; no network. */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

import { parseRanges } from "./pdfRanges.js";
export { parseRanges };

const parse = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
/* pdf-lib can't decrypt: editing an encrypted file would write garbled streams, so refuse (qpdf handles unlock/protect). */
async function load(bytes) {
  const doc = await parse(bytes);
  if (doc.isEncrypted) throw new Error("This PDF is encrypted — unlock it first with Unlock PDF.");
  return doc;
}


async function pickFrom(src, indices) {
  const out = await PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
  return out.save();
}

/** Works on encrypted files too (the page tree isn't encrypted), so the UI can show a count before unlocking. */
export async function pageCount(bytes) { return (await parse(bytes)).getPageCount(); }

export async function mergePdfs(list) {
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await load(bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return out.save();
}

export async function extractPages(bytes, spec) {
  const src = await load(bytes);
  return pickFrom(src, parseRanges(spec, src.getPageCount()));
}

export async function removePages(bytes, spec) {
  const src = await load(bytes);
  const total = src.getPageCount();
  const drop = new Set(parseRanges(spec, total));
  const keep = [...Array(total).keys()].filter((i) => !drop.has(i));
  if (!keep.length) throw new Error("That would remove every page.");
  return pickFrom(src, keep);
}

/** One PDF per range group, e.g. "1-3, 4-6" -> two files; empty spec -> one file per page. */
export async function splitPdf(bytes, spec) {
  const src = await load(bytes);
  const total = src.getPageCount();
  const groups = spec.trim()
    ? spec.split(",").filter((s) => s.trim()).map((s) => parseRanges(s, total))
    : [...Array(total).keys()].map((i) => [i]);
  const out = [];
  for (const g of groups) out.push(await pickFrom(src, g));
  return out;
}

/** rotate: degrees to add (90/180/270) to the pages in `spec` (blank = all). */
export async function rotatePdf(bytes, deg, spec = "") {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  const idx = spec.trim() ? parseRanges(spec, total) : doc.getPageIndices();
  for (const i of idx) {
    const p = doc.getPage(i);
    p.setRotation(degrees((p.getRotation().angle + deg + 360) % 360));
  }
  return doc.save();
}

export async function addPageNumbers(bytes, { position = "bottom-center", start = 1, size = 11 } = {}) {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, i) => {
    const { x: cx, y: cy, width, height } = page.getCropBox();
    const text = String(start + i);
    const w = font.widthOfTextAtSize(text, size);
    const [v, h] = position.split("-");
    const x = cx + (h === "left" ? 36 : h === "right" ? width - 36 - w : (width - w) / 2);
    const y = cy + (v === "top" ? height - 36 : 28);
    page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
  });
  return doc.save();
}

export async function addWatermark(bytes, { text, size = 60, opacity = 0.25, angle = 45, fontBytes = null } = {}) {
  if (!text?.trim()) throw new Error("Enter the watermark text.");
  const doc = await load(bytes);
  let font;
  if (fontBytes) {
    doc.registerFontkit((await import("@pdf-lib/fontkit")).default);
    try { font = await doc.embedFont(fontBytes, { subset: true }); }
    catch { throw new Error("That font file couldn't be read. Use a .ttf, .otf or .woff file."); }
  } else {
    font = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  let w;
  try { w = font.widthOfTextAtSize(text, size); }
  catch { throw new Error("This text has characters the default font can't draw. Choose a font file that supports them (for example a Noto Sans .ttf)."); }
  for (const page of doc.getPages()) {
    const { x: cx, y: cy, width, height } = page.getCropBox();
    const r = (angle * Math.PI) / 180;
    page.drawText(text, {
      x: cx + width / 2 - (w / 2) * Math.cos(r), y: cy + height / 2 - (w / 2) * Math.sin(r) - size / 3,
      size, font, color: rgb(0.5, 0.5, 0.5), opacity, rotate: degrees(angle),
    });
  }
  return doc.save();
}

/** margins in points, trimmed from each edge of the current (visible) CropBox. */
export async function cropPdf(bytes, { top = 0, right = 0, bottom = 0, left = 0 }) {
  const doc = await load(bytes);
  for (const page of doc.getPages()) {
    const cb = page.getCropBox();
    const w = cb.width - left - right, h = cb.height - top - bottom;
    if (w <= 10 || h <= 10) throw new Error("Crop margins leave no page area.");
    page.setCropBox(cb.x + left, cb.y + bottom, w, h);
  }
  return doc.save();
}

/** Re-serialise: fixes many broken xref tables and drops unreferenced objects. Encrypted files are refused (use Unlock PDF). */
export async function rebuildPdf(bytes) {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  return out.save();
}

/** EXIF orientation (1-8) of a JPEG; 1 when absent or unreadable. */
export function jpegOrientation(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 4 || dv.getUint16(0) !== 0xffd8) return 1;
  for (let o = 2; o + 4 <= u8.length;) {
    const m = dv.getUint16(o), len = dv.getUint16(o + 2);
    if ((m & 0xff00) !== 0xff00 || m === 0xffda) return 1;
    if (m === 0xffe1 && len >= 16 && dv.getUint32(o + 4) === 0x45786966 && dv.getUint16(o + 8) === 0) {
      const t = o + 10, le = dv.getUint16(t) === 0x4949;
      if (t + 8 > u8.length) return 1;
      const ifd = t + dv.getUint32(t + 4, le);
      if (ifd + 2 > u8.length) return 1;
      const n = dv.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > u8.length) return 1;
        if (dv.getUint16(e, le) === 0x0112) { const v = dv.getUint16(e + 8, le); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    o += 2 + len;
  }
  return 1;
}

/* pdf-lib ignores EXIF, so rotated phone photos come out sideways. In a browser, bake the orientation into the pixels;
   anywhere else (or on failure) keep the original bytes. */
async function uprightJpeg(bytes) {
  if (jpegOrientation(bytes) <= 1 || typeof createImageBitmap !== "function" || typeof document === "undefined") return bytes;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { imageOrientation: "from-image" });
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) { bmp.close(); return bytes; }
    ctx.drawImage(bmp, 0, 0); bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : bytes;
  } catch { return bytes; }
}

/** images: [{ bytes: Uint8Array, type: "jpg" | "png", }] -> one page per image, sized to the image. */
export async function imagesToPdf(images, { fit = "image", margin = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === "png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(await uprightJpeg(im.bytes));
    const [pw, ph] = fit === "a4" ? [595.28, 841.89] : [img.width + margin * 2, img.height + margin * 2];
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * s, h = img.height * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}

/** Rebuild a PDF from rasterised page JPEGs ({bytes,width,height} in px at `scale`). */
export async function pagesFromJpegs(pages, scale) {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.bytes);
    const page = doc.addPage([p.width / scale, p.height / scale]);
    page.drawImage(img, { x: 0, y: 0, width: p.width / scale, height: p.height / scale });
  }
  return doc.save();
}

/** Stamp images (signatures) onto pages. placements: [{ page (0-based), x, y (centre, fractions from top-left of the visible page),
    w (fraction of page width), bytes, type: "png"|"jpg" }]. Pages with /Rotate are refused (placement maths assumes upright pages). */
export async function placeImages(bytes, placements) {
  const doc = await load(bytes);
  for (const p of placements) {
    const page = doc.getPage(p.page);
    if (page.getRotation().angle % 360 !== 0) throw new Error(`Page ${p.page + 1} is rotated — set it upright with Rotate PDF first.`);
    const img = p.type === "jpg" ? await doc.embedJpg(p.bytes) : await doc.embedPng(p.bytes);
    const cb = page.getCropBox();
    const w = p.w * cb.width, h = (img.height / img.width) * w;
    page.drawImage(img, { x: cb.x + p.x * cb.width - w / 2, y: cb.y + (1 - p.y) * cb.height - h / 2, width: w, height: h });
  }
  return doc.save();
}
