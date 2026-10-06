/* Sheaf: core.js
   DOM helpers, icons, saving, opening files, page rendering, PDF building blocks.
   Plain scripts loaded in order by index.html; they share one top-level scope. */
'use strict';
if (!window.PDFLib || !window.pdfjsLib || !window.JSZip || !window.Sortable) {
  document.getElementById('app').innerHTML =
    '<p style="padding:40px;max-width:60ch">The PDF libraries did not load. Check your connection and reload the page.</p>';
  throw new Error('Sheaf: the PDF libraries failed to load');
}

const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFNumber, PDFRawStream, PDFArray, decodePDFRawStream } = PDFLib;
/* pdf.js and its worker are self-hosted; js/pdfjs.js sets workerSrc. */

/* =====================================================================
   1. Small helpers
===================================================================== */
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = d => ((Math.round(d) % 360) + 360) % 360;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const baseName = n => n.replace(/\.[^.\\/]+$/, '') || 'file';

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const p in v) { if (p.startsWith('--')) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const ICONS = {
  logo: '<path d="M9.500 6.500V3h6.500l4.500 4.500V17h-4" opacity=".55"/><path d="M3.500 7h7L15 11.500V21H3.500z"/><path d="M10.500 7v4.500H15"/>',
  merge: '<path d="M4 4h6v6H4zM14 4h6v6h-6z"/><path d="M7 10v2.5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V10M12 14.500V20M9.500 17.500 12 20l2.500-2.500"/>',
  split: '<path d="M9 3.500h6v6H9z"/><path d="M12 9.500V12M12 12H7v6M12 12h5v6M4.500 15.500 7 18l2.500-2.500M14.500 15.500 17 18l2.500-2.500"/>',
  remove: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M10 12.500l5 5M15 12.500l-5 5"/>',
  extract: '<path d="M12 21H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7l5 5v3.500"/><path d="M14 3v5h5M13 17.500h8M18.500 15 21 17.500 18.500 20"/>',
  organize: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  compress: '<path d="M12 3v6.500M9 6.500l3 3 3-3M12 21v-6.500M9 17.500l3-3 3 3M4 12h16"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.600-5.900"/><path d="M20 3.500V9h-5.500"/>',
  img2pdf: '<path d="M4 5h16v14H4z"/><path d="m4 15.500 4.500-4.500 4 4 2.500-2.500 5 5"/><circle cx="15.500" cy="9" r="1.200"/>',
  pdf2jpg: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.500 17.500l2.500-3 2 2 1.500-1.500 2 2.500"/>',
  pagenum: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M11 13.500l1.500-1v5M10.700 17.500h3.100"/>',
  watermark: '<path d="M10 3h4a1 1 0 0 1 1 1v3.500c0 1.200.600 2.200 1.600 2.700l.900.400A2.500 2.500 0 0 1 19 12.900V15H5v-2.100a2.500 2.500 0 0 1 1.500-2.300l.900-.400c1-.500 1.600-1.500 1.600-2.700V4a1 1 0 0 1 1-1z"/><path d="M5 18.500h14M5 21h14"/>',
  crop: '<path d="M7 2.500V17h14.500M2.500 7H17v14.500"/>',
  protect: '<path d="M6 11h12v9.500H6z"/><path d="M8.500 11V8a3.500 3.500 0 0 1 7 0v3M12 14.500v2.500"/>',
  unlock: '<path d="M6 11h12v9.500H6z"/><path d="M8.500 11V8a3.500 3.500 0 0 1 6.800-1.200M12 14.500v2.500"/>',
  sign: '<path d="M3 16.500c2-5 4-8 5.500-8s0 6.500 1.500 6.500 2-3.500 3.500-3.500 1 3.500 3 3.500H21M3 20.500h18"/>',
  upload: '<path d="M12 16V4M7 8.500 12 3.500l5 5M4 15v4a1.500 1.500 0 0 0 1.500 1.500h13A1.500 1.500 0 0 0 20 19v-4"/>',
  download: '<path d="M12 4v12M7 11.500l5 5 5-5M4 20.500h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
  cw: '<path d="M20 12a8 8 0 1 1-2.600-5.900"/><path d="M20 3.500V9h-5.500"/>',
  ccw: '<path d="M4 12a8 8 0 1 0 2.600-5.900"/><path d="M4 3.500V9h5.500"/>',
  copy: '<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/>',
  left: '<path d="m14.500 5.500-6.500 6.500 6.500 6.500"/>',
  right: '<path d="m9.500 5.500 6.500 6.500-6.500 6.500"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>',
};
function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ico');
  s.innerHTML = ICONS[name] || '';
  return s;
}
const btn = (label, onclick, cls = 'btn', ic) => h('button', { type: 'button', class: cls, onclick }, ic && icon(ic, 18), label);
const tb = (ic, label, onclick, cls = '') => h('button', { type: 'button', class: 'tb ' + cls, 'aria-label': label, title: label, onclick }, icon(ic, 15));

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 2);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
}

function toast(msg, kind = '') {
  const el = h('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3600);
}

/* "1, 3-5, 8-" -> sorted 0-based page indexes. Returns null when the text is not a valid list. */
function parsePages(str, max) {
  const s = String(str).replace(/\s*-\s*/g, '-').trim();
  if (!s) return [];
  const out = new Set();
  for (const part of s.split(/[,;\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)(-(\d+)?)?$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = m[2] ? (m[3] ? +m[3] : max) : a;
    if (a < 1 || b < a || b > max) return null;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}
function formatPages(idx) {
  const parts = []; let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    parts.push(j > i ? `${idx[i] + 1}-${idx[j] + 1}` : `${idx[i] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function makeCanvas(w, hh) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; }
const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('The browser could not encode the image.')), type, q));
function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be read.')); im.src = url; });
}
function explain(e) {
  const m = (e && e.message) || String(e);
  if (e && e.name === 'InvalidPDFException') return 'The file is damaged or is not a PDF.';
  if (/password/i.test(m)) return 'The password was not accepted.';
  if (/encrypted/i.test(m)) return 'The file is password-protected.';
  return m.length > 140 ? m.slice(0, 140) + '…' : m;
}

/* =====================================================================
   2. Saving files
   Inside a claude.ai artifact, saving goes through the "downloads"
   capability. Anywhere else (your own hosting) it is a normal download.
===================================================================== */
const downloadsCap = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

async function saveFile(name, blob) {
  const cap = await downloadsCap;
  if (cap) {
    try { await cap.save({ filename: name, data: blob }); toast(`Saved ${name}`, 'ok'); return; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') return toast('A save prompt is already open.');
      if (code === 'too_large') return toast('That file is too large to save from here.', 'err');
      if (code === 'rejected_extension' || code === 'extension_not_enabled') return toast('This file type cannot be saved from here.', 'err');
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function zipBlob(outputs) {
  const zip = new JSZip();
  const seen = new Map();
  for (const o of outputs) {
    let name = o.name; const k = seen.get(name) || 0; seen.set(name, k + 1);
    if (k) name = name.replace(/(\.[^.]+)$/, ` (${k + 1})$1`);
    zip.file(name, o.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
const pdfOut = (name, bytes, extra) => Object.assign({ name, blob: new Blob([bytes], { type: 'application/pdf' }) }, extra);

/* =====================================================================
   3. Opening files
===================================================================== */
let uid = 0;
const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
function kindOf(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (/^image\//.test(file.type) || IMG_EXT.test(file.name)) return 'image';
  return null;
}

function askPassword(name, wrong) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'password', class: 'inp', autocomplete: 'off', placeholder: 'Password', 'aria-label': 'Password' });
    let settled = false;
    const done = v => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    const dlg = h('dialog', { class: 'dlg' }, h('div', { class: 'dlg-b' },
      h('h2', null, 'This PDF is locked'),
      h('p', { class: 'muted' }, wrong ? `That password did not open ${name}. Try again.` : `Enter the password for ${name}.`),
      inp,
      h('div', { class: 'dlg-f' }, btn('Skip this file', () => done(null)), btn('Open', () => done(inp.value), 'btn primary'))));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value); });
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    document.body.append(dlg); dlg.showModal(); inp.focus();
  });
}

function openPdfJs(d) {
  return new Promise((resolve, reject) => {
    const task = pdfjsLib.getDocument({ data: d.bytes.slice(), password: d.password, isEvalSupported: false });
    task.onPassword = async (update, reason) => {
      const pw = await askPassword(d.name, reason === 2);
      if (pw == null) { reject(Object.assign(new Error('Skipped'), { code: 'cancelled' })); task.destroy().catch(() => {}); }
      else { d.password = pw; d.locked = true; update(pw); }
    };
    task.promise.then(resolve, reject);
  });
}

/* Orientation tag of a JPEG, so phone photos land upright in the PDF. */
function exifOrientation(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return 1;
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xFF) {
    const marker = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      const t = p + 10, le = b[t] === 0x49;
      const u16 = o => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
      const u32 = o => le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const ifd = t + u32(t + 4), n = u16(ifd);
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > b.length) break; if (u16(e) === 0x0112) return u16(e + 8) || 1; }
      return 1;
    }
    if (marker === 0xDA || len < 2) break;
    p += 2 + len;
  }
  return 1;
}

async function makeDoc(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const d = { id: ++uid, name: file.name, size: bytes.length, bytes, kind: kindOf(file), rot: 0, thumbs: new Map() };
  if (d.kind === 'pdf') {
    d.js = await openPdfJs(d);
    d.pages = d.js.numPages;
    if (!d.locked) { try { d.locked = !!(await d.js.getPermissions()); } catch { /* not encrypted */ } }
    return d;
  }
  d.mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
  d.exif = d.mime === 'image/jpeg' ? exifOrientation(bytes) : 1;
  let bmp;
  try { bmp = await createImageBitmap(new Blob([bytes], { type: d.mime }), { imageOrientation: 'from-image' }); }
  catch { throw new Error('This browser cannot read that image format. Use JPG, PNG or WebP.'); }
  d.w = bmp.width; d.h = bmp.height; d.pages = 1;
  const s = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * s, bmp.height * s);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  d.thumbs.set(1, c.toDataURL('image/jpeg', 0.82));
  bmp.close && bmp.close();
  return d;
}
function closeDoc(d) { try { d.js && d.js.destroy(); } catch { /* already gone */ } d.thumbs.clear(); }

/* A fresh, writable copy of the document for each run. */
async function loadLib(d) {
  try { return await PDFDocument.load(d.bytes); }
  catch (e) {
    if (!/encrypted/i.test(e.message || '')) throw e;
    return PDFDocument.load(d.bytes, { password: d.password || '' });
  }
}

/* =====================================================================
   4. Drawing pages
===================================================================== */
async function renderPage(d, n, scale, maxSide = 5000) {
  const page = await d.js.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const s = Math.min(scale, maxSide / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale: s });
  const c = makeCanvas(vp.width, vp.height);
  await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
  return c;
}

/* Thumbnails are drawn one at a time, only when a page scrolls into view. */
const thumbQueue = []; let thumbBusy = false;
function thumb(d, n) {
  if (d.thumbs.has(n)) return Promise.resolve(d.thumbs.get(n));
  return new Promise(resolve => { thumbQueue.push({ d, n, resolve }); pumpThumbs(); });
}
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQueue.length) {
    const job = thumbQueue.shift();
    let url = job.d.thumbs.get(job.n) || null;
    if (!url && job.d.js) {
      try {
        const page = await job.d.js.getPage(job.n);
        const base = page.getViewport({ scale: 1 });
        const c = await renderPage(job.d, job.n, 300 / Math.max(base.width, base.height));
        url = c.toDataURL('image/jpeg', 0.8); job.d.thumbs.set(job.n, url);
      } catch { url = null; }
    }
    job.resolve(url);
    await tick();
  }
  thumbBusy = false;
}
const lazy = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); e.target._load && e.target._load(); }
}, { rootMargin: '400px' });

/* The page as a person sees it (after /Rotate and the crop box), mapped back to PDF space.
   u runs left to right and v bottom to top across the visible page; `angle` is what upright
   content must be rotated by. Every stamp (numbers, watermarks, signatures) goes through this
   so sideways scans come out right. */
function frameOf(page) {
  const b = page.getCropBox(), r = norm(page.getRotation().angle);
  const side = r === 90 || r === 270;
  return {
    W: side ? b.height : b.width, H: side ? b.width : b.height, angle: r,
    toPdf(u, v) {
      if (r === 90) return { x: b.x + b.width - v, y: b.y + u };
      if (r === 180) return { x: b.x + b.width - u, y: b.y + b.height - v };
      if (r === 270) return { x: b.x + v, y: b.y + b.height - u };
      return { x: b.x + u, y: b.y + v };
    },
  };
}

/* Build a new PDF from a list of {doc, i, rot, blank} page picks. */
async function buildPdf(picks, progress, libs = new Map()) {
  const out = await PDFDocument.create();
  const byDoc = new Map();
  picks.forEach((p, k) => { if (!p.blank) (byDoc.get(p.doc) || byDoc.set(p.doc, []).get(p.doc)).push(k); });
  const copied = new Array(picks.length); let done = 0;
  for (const [d, ks] of byDoc) {
    if (progress) await progress(done / picks.length * 0.8, `Reading ${d.name}`);
    if (!libs.has(d)) libs.set(d, await loadLib(d));   // pass one Map across calls to parse each source once
    const src = libs.get(d);
    const got = await out.copyPages(src, ks.map(k => picks[k].i));
    ks.forEach((k, j) => { copied[k] = got[j]; });
    done += ks.length;
  }
  let last = [595.28, 841.89];
  picks.forEach((p, k) => {
    if (p.blank) { out.addPage(last); return; }
    const pg = copied[k];
    if (norm(p.rot)) pg.setRotation(degrees(norm(pg.getRotation().angle + p.rot)));
    out.addPage(pg);
    const s = pg.getSize(); last = [s.width, s.height];
  });
  if (progress) await progress(0.9, 'Writing the PDF');
  return out.save();
}

/* Text that the built-in PDF fonts cannot spell (Hindi, Kannada, CJK, emoji...) is drawn as a picture instead. */
function canEncode(font, text) {
  const set = new Set(font.getCharacterSet());
  for (const ch of text) if (!set.has(ch.codePointAt(0))) return false;
  return true;
}
function textImage(text, size, color, weight = 400, family = 'Helvetica, Arial, "Noto Sans", sans-serif', room = 1.5) {
  const k = 4, px = size * k;
  const probe = makeCanvas(4, 4).getContext('2d'); probe.font = `${weight} ${px}px ${family}`;
  const w = Math.ceil(probe.measureText(text).width) + px * (room - 1.2), hh = Math.ceil(px * room);
  const c = makeCanvas(w, hh), g = c.getContext('2d');
  g.font = `${weight} ${px}px ${family}`; g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, w / 2, hh / 2);
  return { canvas: c, url: c.toDataURL('image/png'), w: w / k, h: hh / k };
}
