/* Browser-only helpers built on pdf.js (canvas rendering, text extraction). */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pagesFromJpegs } from "./pdf.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const open = (bytes) => pdfjs.getDocument({ data: bytes.slice(0) }).promise;
/* pdf.js keeps the parsed document (and its worker-side copy) alive until destroy(). */
async function withPdf(bytes, fn) {
  const pdf = await open(bytes);
  try { return await fn(pdf); } finally { pdf.destroy(); }
}

function ctx2d(canvas, opts) {
  const ctx = canvas.getContext("2d", opts);
  if (!ctx) throw new Error("This page is too large to render on this device.");
  return ctx;
}

const toJpeg = (canvas, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((x) => res(new Uint8Array(x))) : rej(new Error("Canvas export failed"))), "image/jpeg", q));

/** Page n on a white canvas; `width` in px, or a fixed `scale` when width is null. */
async function renderCanvas(pdf, n, width, { scale, read } = {}) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: scale ?? width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = ctx2d(canvas, read ? { willReadFrequently: true } : undefined);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

async function renderPage(pdf, n, scale, quality) {
  const canvas = await renderCanvas(pdf, n, null, { scale });
  const out = { bytes: await toJpeg(canvas, quality), width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return out;
}

/** PDF -> array of JPEG byte arrays (one per page). */
export function pdfToJpegs(bytes, { scale = 2, quality = 0.9, onProgress } = {}) {
  return withPdf(bytes, async (pdf) => {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      out.push((await renderPage(pdf, i, scale, quality)).bytes);
      onProgress?.(i, pdf.numPages);
    }
    return out;
  });
}

/** Image-based compression: re-renders each page as JPEG. Text becomes non-selectable. */
export async function compressPdf(bytes, { level = "medium", onProgress } = {}) {
  const { scale, quality } = { low: { scale: 1.6, quality: 0.8 }, medium: { scale: 1.3, quality: 0.65 }, high: { scale: 1, quality: 0.5 } }[level];
  const pages = await withPdf(bytes, async (pdf) => {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      out.push(await renderPage(pdf, i, scale, quality));
      onProgress?.(i, pdf.numPages);
    }
    return out;
  });
  return pagesFromJpegs(pages, scale);
}

/** Group a page's text items into lines (by baseline), then paragraphs (by vertical gap). */
function pageParagraphs(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str?.trim() && !it.hasEOL) continue;
    const y = it.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (row) row.items.push(it); else rows.push({ y, h: it.height || 10, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  const paras = [];
  let cur = null, prev = null;
  for (const r of rows) {
    r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const gap = prev ? prev.y - r.y : 0;
    if (!cur || gap > r.h * 1.8) { cur = { text, size: r.h }; paras.push(cur); } else cur.text += " " + text;
    prev = r;
  }
  return paras;
}

/** PDF -> editable DOCX (text only; layout, images and tables are not reproduced). Returns {blob, chars}. */
export async function pdfToDocx(bytes, { onProgress } = {}) {
  const { Document, Packer, Paragraph, TextRun, PageBreak } = await import("docx");
  const children = [];
  let chars = 0;
  await withPdf(bytes, async (pdf) => {
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      const paras = pageParagraphs(tc.items);
      paras.forEach((p) => {
        chars += p.text.length;
        children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p.text, size: Math.max(16, Math.min(48, Math.round(p.size * 2))) })] }));
      });
      if (i < pdf.numPages) children.push(new Paragraph({ children: [new PageBreak()] }));
      onProgress?.(i, pdf.numPages);
    }
  });
  if (!chars) throw new Error("No selectable text found. This looks like a scanned PDF — OCR isn't available.");
  return { blob: await Packer.toBlob(new Document({ sections: [{ children }] })), chars };
}

/** Small JPEG data-URL thumbnails for the first `max` pages. */
export function pdfThumbs(bytes, { max = 60, width = 120, signal } = {}) {
  return withPdf(bytes, async (pdf) => {
    const n = Math.min(pdf.numPages, max);
    const out = [];
    for (let i = 1; i <= n; i++) {
      if (signal?.aborted) break;
      const canvas = await renderCanvas(pdf, i, width);
      out.push(canvas.toDataURL("image/jpeg", 0.6));
      canvas.width = canvas.height = 0;
    }
    return { thumbs: out, total: pdf.numPages };
  });
}

/** Open once, render many pages (previews, comparison). Call close() when finished. */
export async function pdfSession(bytes) {
  const pdf = await open(bytes);
  const clamp = (n) => Math.min(Math.max(1, n), pdf.numPages);
  return {
    total: pdf.numPages,
    async image(pageNum, width = 560) {
      const c = await renderCanvas(pdf, clamp(pageNum), width);
      const out = { url: c.toDataURL("image/jpeg", 0.85), width: c.width, height: c.height, total: pdf.numPages };
      c.width = c.height = 0;
      return out;
    },
    async rgba(pageNum, width = 500) {
      const c = await renderCanvas(pdf, clamp(pageNum), width, { read: true });
      const d = ctx2d(c, { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      return { width: c.width, height: c.height, data: d.data };
    },
    async text() {
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        pages.push(tc.items.map((it) => it.str).join(" "));
      }
      return pages;
    },
    close: () => pdf.destroy(),
  };
}

async function oneShot(bytes, fn) {
  const s = await pdfSession(bytes);
  try { return await fn(s); } finally { s.close(); }
}

/** One page as a data URL (for previews / click-to-place). */
export const pdfPageImage = (bytes, pageNum, width = 560) => oneShot(bytes, (s) => s.image(pageNum, width));

/** Raw RGBA of one page (for pixel comparison). */
export const pdfPageRgba = (bytes, pageNum, width = 500) => oneShot(bytes, (s) => s.rgba(pageNum, width));

/** Selectable text of every page. */
export const pdfTextPages = (bytes) => oneShot(bytes, (s) => s.text());

export const pdfPageCount = (bytes) => withPdf(bytes, (pdf) => pdf.numPages);

/** OCR -> searchable PDF + plain text. tesseract.js downloads its worker, WASM core and language data from a CDN
    (jsDelivr) on first use; the document itself is processed locally and never uploaded. */
export async function ocrPdf(bytes, { lang = "eng", scale = 2, onProgress } = {}) {
  const [{ createWorker }, { mergePdfs }] = await Promise.all([import("tesseract.js"), import("./pdf.js")]);
  return withPdf(bytes, async (pdf) => {
    const worker = await createWorker(lang);
    try {
      const pages = [], texts = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const canvas = await renderCanvas(pdf, i, null, { scale });
        const { data } = await worker.recognize(canvas, {}, { pdf: true });
        canvas.width = canvas.height = 0;
        if (!data?.pdf) throw new Error("OCR engine returned no PDF output.");
        pages.push(new Uint8Array(data.pdf)); texts.push(data.text || "");
        onProgress?.(i, pdf.numPages);
      }
      return { pdf: await mergePdfs(pages), text: texts.join("\n\n").trim() };
    } finally { await worker.terminate(); }
  });
}
