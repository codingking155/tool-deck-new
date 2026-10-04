/* Browser-only PDF operations. Libraries are imported on first use so the
   PDF tool's own chunk stays small until someone actually runs an action. */

let pdfjsPromise;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}
const getPdfLib = () => import("pdf-lib");

export class PdfError extends Error {}

function friendly(e, name) {
  const m = String(e?.message || e);
  if (/encrypt|password/i.test(m) || e?.name === "PasswordException") return new PdfError(`${name} is password-protected. Remove the password first, then try again.`);
  if (/invalid|parse|No PDF header|Failed to parse/i.test(m) || e?.name === "InvalidPDFException") return new PdfError(`${name} doesn't look like a valid PDF.`);
  return e instanceof PdfError ? e : new PdfError(`${name}: ${m}`);
}

async function loadLib(bytes, name) {
  const { PDFDocument } = await getPdfLib();
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw friendly(e, name); }
}

async function loadJs(bytes, name) {
  const pdfjs = await getPdfjs();
  try { return await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; }
  catch (e) { throw friendly(e, name); }
}

export async function pageCount(bytes, name) {
  const doc = await loadJs(bytes, name);
  const n = doc.numPages;
  doc.destroy();
  return n;
}

export async function mergePdfs(files, onProgress) {
  const { PDFDocument } = await getPdfLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const src = await loadLib(files[i].bytes, files[i].name);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    onProgress?.((i + 1) / files.length);
  }
  return out.save({ useObjectStreams: true });
}

export async function extractGroups(bytes, name, groups) {
  const { PDFDocument } = await getPdfLib();
  const src = await loadLib(bytes, name);
  const outs = [];
  for (const g of groups) {
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, g)).forEach((p) => doc.addPage(p));
    outs.push(await doc.save({ useObjectStreams: true }));
  }
  return outs;
}

/* Lossless: rewrite with object streams and drop unused objects. Often small gains. */
export async function compressLossless(bytes, name) {
  const { PDFDocument } = await getPdfLib();
  const src = await loadLib(bytes, name);
  const doc = await PDFDocument.create();
  (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p));
  return doc.save({ useObjectStreams: true });
}

async function renderPage(doc, n, scale, type, quality) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const base = page.getViewport({ scale: 1 });
  const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
  canvas.width = canvas.height = 0;
  page.cleanup();
  return { blob, widthPt: base.width, heightPt: base.height };
}

/* Strong: re-draw every page as a JPEG. Big savings on scans; text stops being selectable. */
export async function compressRaster(bytes, name, { dpi, quality }, onProgress) {
  const { PDFDocument } = await getPdfLib();
  const src = await loadJs(bytes, name);
  const out = await PDFDocument.create();
  try {
    for (let n = 1; n <= src.numPages; n++) {
      const r = await renderPage(src, n, dpi / 72, "image/jpeg", quality);
      const img = await out.embedJpg(new Uint8Array(await r.blob.arrayBuffer()));
      out.addPage([r.widthPt, r.heightPt]).drawImage(img, { x: 0, y: 0, width: r.widthPt, height: r.heightPt });
      onProgress?.(n / src.numPages);
    }
  } finally { src.destroy(); }
  return out.save({ useObjectStreams: true });
}

export async function pdfToImages(bytes, name, { dpi, type, quality }, onProgress) {
  const src = await loadJs(bytes, name);
  const res = [];
  try {
    for (let n = 1; n <= src.numPages; n++) {
      const r = await renderPage(src, n, dpi / 72, type, quality);
      res.push(r.blob);
      onProgress?.(n / src.numPages);
    }
  } finally { src.destroy(); }
  return res;
}

const A4 = [595.28, 841.89];
/* fit: "image" = page sized to the picture; "a4" = A4 portrait/landscape with margins. */
export async function imagesToPdf(files, fit, onProgress) {
  const { PDFDocument } = await getPdfLib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let img;
    if (f.type === "image/jpeg") img = await doc.embedJpg(new Uint8Array(await f.arrayBuffer()));
    else if (f.type === "image/png") img = await doc.embedPng(new Uint8Array(await f.arrayBuffer()));
    else {
      /* WebP/GIF/etc. → PNG via canvas, since PDFs can only embed JPEG/PNG directly. */
      const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close?.();
      const b = await new Promise((r) => c.toBlob(r, "image/png"));
      img = await doc.embedPng(new Uint8Array(await b.arrayBuffer()));
    }
    if (fit === "image") {
      doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const land = img.width > img.height;
      const [pw, ph] = land ? [A4[1], A4[0]] : A4;
      const m = 28;
      const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height, 1);
      const w = img.width * s, h = img.height * s;
      doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    onProgress?.((i + 1) / files.length);
  }
  return doc.save({ useObjectStreams: true });
}

export async function extractText(bytes, name, onProgress) {
  const src = await loadJs(bytes, name);
  const pages = [];
  try {
    for (let n = 1; n <= src.numPages; n++) {
      const page = await src.getPage(n);
      const tc = await page.getTextContent();
      let s = "";
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        s += it.str;
        if (it.hasEOL) s += "\n";
      }
      pages.push(s.replace(/[ \t]+\n/g, "\n").trim());
      page.cleanup();
      onProgress?.(n / src.numPages);
    }
  } finally { src.destroy(); }
  return pages;
}
