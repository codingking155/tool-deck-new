/* Pure PDF operations (pdf-lib). Everything runs in the browser; no network. */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

import { parseRanges } from "./pdfRanges.js";
export { parseRanges };

const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });


async function pick(bytes, indices) {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
  return out.save();
}

export async function pageCount(bytes) { return (await load(bytes)).getPageCount(); }

export async function mergePdfs(list) {
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await load(bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return out.save();
}

export async function extractPages(bytes, spec) {
  const total = await pageCount(bytes);
  return pick(bytes, parseRanges(spec, total));
}

export async function removePages(bytes, spec) {
  const total = await pageCount(bytes);
  const drop = new Set(parseRanges(spec, total));
  const keep = [...Array(total).keys()].filter((i) => !drop.has(i));
  if (!keep.length) throw new Error("That would remove every page.");
  return pick(bytes, keep);
}

/** One PDF per range group, e.g. "1-3, 4-6" -> two files; empty spec -> one file per page. */
export async function splitPdf(bytes, spec) {
  const total = await pageCount(bytes);
  const groups = spec.trim()
    ? spec.split(",").filter((s) => s.trim()).map((s) => parseRanges(s, total))
    : [...Array(total).keys()].map((i) => [i]);
  return Promise.all(groups.map((g) => pick(bytes, g)));
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
    const { width, height } = page.getSize();
    const text = String(start + i);
    const w = font.widthOfTextAtSize(text, size);
    const [v, h] = position.split("-");
    const x = h === "left" ? 36 : h === "right" ? width - 36 - w : (width - w) / 2;
    const y = v === "top" ? height - 36 : 28;
    page.drawText(text, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
  });
  return doc.save();
}

export async function addWatermark(bytes, { text, size = 60, opacity = 0.25, angle = 45 } = {}) {
  if (!text?.trim()) throw new Error("Enter the watermark text.");
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = font.widthOfTextAtSize(text, size);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const r = (angle * Math.PI) / 180;
    page.drawText(text, {
      x: width / 2 - (w / 2) * Math.cos(r), y: height / 2 - (w / 2) * Math.sin(r) - size / 3,
      size, font, color: rgb(0.5, 0.5, 0.5), opacity, rotate: degrees(angle),
    });
  }
  return doc.save();
}

/** margins in points, trimmed from each edge. */
export async function cropPdf(bytes, { top = 0, right = 0, bottom = 0, left = 0 }) {
  const doc = await load(bytes);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const w = width - left - right, h = height - top - bottom;
    if (w <= 10 || h <= 10) throw new Error("Crop margins leave no page area.");
    page.setCropBox(left, bottom, w, h);
  }
  return doc.save();
}

/** Re-serialise: fixes many broken xref tables and drops unreferenced objects. Also strips owner-password restrictions on PDFs that need no open password. */
export async function rebuildPdf(bytes) {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  return out.save();
}

/** images: [{ bytes: Uint8Array, type: "jpg" | "png", }] -> one page per image, sized to the image. */
export async function imagesToPdf(images, { fit = "image", margin = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === "png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
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
