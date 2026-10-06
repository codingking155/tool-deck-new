/* Browser-only helpers built on pdf.js (canvas rendering, text extraction). */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pagesFromJpegs } from "./pdf.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const open = (bytes) => pdfjs.getDocument({ data: bytes.slice(0) }).promise;

const toJpeg = (canvas, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? b.arrayBuffer().then((x) => res(new Uint8Array(x))) : rej(new Error("Canvas export failed"))), "image/jpeg", q));

async function renderPage(pdf, n, scale, quality) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { bytes: await toJpeg(canvas, quality), width: canvas.width, height: canvas.height };
}

/** PDF -> array of JPEG byte arrays (one per page). */
export async function pdfToJpegs(bytes, { scale = 2, quality = 0.9, onProgress } = {}) {
  const pdf = await open(bytes);
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    out.push((await renderPage(pdf, i, scale, quality)).bytes);
    onProgress?.(i, pdf.numPages);
  }
  return out;
}

/** Image-based compression: re-renders each page as JPEG. Text becomes non-selectable. */
export async function compressPdf(bytes, { level = "medium", onProgress } = {}) {
  const { scale, quality } = { low: { scale: 1.6, quality: 0.8 }, medium: { scale: 1.3, quality: 0.65 }, high: { scale: 1, quality: 0.5 } }[level];
  const pdf = await open(bytes);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    pages.push(await renderPage(pdf, i, scale, quality));
    onProgress?.(i, pdf.numPages);
  }
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
  const pdf = await open(bytes);
  const children = [];
  let chars = 0;
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
  if (!chars) throw new Error("No selectable text found. This looks like a scanned PDF — OCR isn't available.");
  return { blob: await Packer.toBlob(new Document({ sections: [{ children }] })), chars };
}

/** Small JPEG data-URL thumbnails for the first `max` pages. */
export async function pdfThumbs(bytes, { max = 60, width = 120, signal } = {}) {
  const pdf = await open(bytes);
  const n = Math.min(pdf.numPages, max);
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (signal?.aborted) break;
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas.toDataURL("image/jpeg", 0.6));
  }
  return { thumbs: out, total: pdf.numPages };
}
