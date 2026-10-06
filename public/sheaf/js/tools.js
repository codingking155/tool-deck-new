/* Sheaf: tools.js
   The 15 tools. Each has mount() for its workspace and run() for the PDF work.
   Plain scripts loaded in order by index.html; they share one top-level scope. */
'use strict';
/* =====================================================================
   6. Tools
   Each tool: mount(ctx, work, side) builds its workspace and options,
   run(ctx, progress) returns { title, note?, outputs: [{name, blob}] }.
===================================================================== */
const CATS = [['organize', 'Organize'], ['optimize', 'Optimize'], ['convert', 'Convert'], ['edit', 'Edit'], ['security', 'Security']];
const GROUP_COLORS = ['#2f7fd3', '#d9506a', '#8b5cd6', '#c46d12', '#12876a', '#44524c'];
const N = s => PDFName.of(s);
const numOf = o => (o && typeof o.asNumber === 'function') ? o.asNumber() : undefined;
const pad3 = n => String(n).padStart(3, '0');

/* ---------- compress: re-encode the images inside, leave text and vectors alone ---------- */
const LEVELS = { extreme: { max: 1100, q: 0.5 }, recommended: { max: 1700, q: 0.68 }, light: { max: 2600, q: 0.82 } };

function imageInfo(stream) {
  const d = stream.dict;
  if (d.lookup(N('Subtype')) !== N('Image') || d.has(N('ImageMask')) || d.has(N('Mask')) || d.has(N('Decode'))) return null;
  const w = numOf(d.lookup(N('Width'))), hh = numOf(d.lookup(N('Height')));
  if (!w || !hh || numOf(d.lookup(N('BitsPerComponent'))) !== 8) return null;
  const cs = d.lookup(N('ColorSpace')); let comps = 0;
  if (cs === N('DeviceRGB')) comps = 3; else if (cs === N('DeviceGray')) comps = 1;
  else if (cs instanceof PDFArray && cs.lookup(0) === N('ICCBased')) { const icc = cs.lookup(1), n = icc && icc.dict && numOf(icc.dict.lookup(N('N'))); if (n === 3 || n === 1) comps = n; }
  if (!comps) return null;
  let f = d.lookup(N('Filter'));
  if (f instanceof PDFArray) { if (f.size() !== 1) return null; f = f.lookup(0); }
  if (f !== N('DCTDecode') && f !== N('FlateDecode')) return null;
  return { w, h: hh, comps, dct: f === N('DCTDecode') };
}
/* Undo PNG row filters (PDF "Predictor" 10-15). */
function unpredict(data, cols, comps) {
  const row = cols * comps, rows = Math.floor(data.length / (row + 1)), out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const ft = data[y * (row + 1)], src = y * (row + 1) + 1, dst = y * row, up = dst - row;
    for (let x = 0; x < row; x++) {
      const a = x >= comps ? out[dst + x - comps] : 0, b = y ? out[up + x] : 0, c = (y && x >= comps) ? out[up + x - comps] : 0;
      let add = 0;
      if (ft === 1) add = a; else if (ft === 2) add = b; else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
      out[dst + x] = (data[src + x] + add) & 255;
    }
  }
  return out;
}
/* Remove EXIF so the browser decodes the JPEG exactly as stored, the way PDF viewers do. */
function stripExif(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return b;
  const keep = [b.subarray(0, 2)]; let p = 2, changed = false;
  while (p + 4 <= b.length && b[p] === 0xFF && b[p + 1] !== 0xDA) {
    const len = 2 + ((b[p + 2] << 8) | b[p + 3]);
    if (b[p + 1] === 0xE1) changed = true; else keep.push(b.subarray(p, p + len));
    p += len;
  }
  if (!changed) return b;
  keep.push(b.subarray(p));
  return new Blob(keep);
}
async function recompressImage(stream, info, cfg) {
  const raw = stream.contents, dict = stream.dict;
  if (info.w * info.h < 90000 || raw.length < 12000) return null;
  let src;
  if (info.dct) {
    src = await createImageBitmap(new Blob([stripExif(raw)], { type: 'image/jpeg' }));
    if (src.width !== info.w || src.height !== info.h) return null;
  } else {
    let data = decodePDFRawStream(stream).decode();
    let parms = dict.lookup(N('DecodeParms'));
    if (parms instanceof PDFArray) parms = parms.lookup(0);
    const pred = (parms && parms.lookup && numOf(parms.lookup(N('Predictor')))) || 1;
    if (pred === 2) return null;
    if (pred >= 10) data = unpredict(data, info.w, info.comps);
    if (data.length < info.w * info.h * info.comps) return null;
    const px = new Uint8ClampedArray(info.w * info.h * 4);
    if (info.comps === 3) for (let i = 0, j = 0; j < px.length; i += 3, j += 4) { px[j] = data[i]; px[j + 1] = data[i + 1]; px[j + 2] = data[i + 2]; px[j + 3] = 255; }
    else for (let i = 0, j = 0; j < px.length; i++, j += 4) { px[j] = px[j + 1] = px[j + 2] = data[i]; px[j + 3] = 255; }
    src = makeCanvas(info.w, info.h); src.getContext('2d').putImageData(new ImageData(px, info.w, info.h), 0, 0);
  }
  const s = Math.min(1, cfg.max / Math.max(info.w, info.h));
  const c = makeCanvas(info.w * s, info.h * s), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  const blob = await canvasBlob(c, 'image/jpeg', cfg.q);
  if (blob.size > raw.length * 0.9) return null;
  dict.set(N('Width'), PDFNumber.of(c.width)); dict.set(N('Height'), PDFNumber.of(c.height));
  dict.set(N('BitsPerComponent'), PDFNumber.of(8)); dict.set(N('Filter'), N('DCTDecode'));
  if (info.comps !== 3) dict.set(N('ColorSpace'), N('DeviceRGB'));
  dict.delete(N('DecodeParms'));
  return PDFRawStream.of(dict, new Uint8Array(await blob.arrayBuffer()));
}
async function compressPdf(d, level, progress) {
  const lib = await loadLib(d), targets = [];
  for (const [ref, obj] of lib.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let info = null; try { info = imageInfo(obj); } catch { /* odd dictionary: leave it alone */ }
    if (info) targets.push([ref, obj, info]);
  }
  for (let k = 0; k < targets.length; k++) {
    await progress(k / (targets.length + 1), `${d.name}: image ${k + 1} of ${targets.length}`);
    try { const next = await recompressImage(targets[k][1], targets[k][2], LEVELS[level]); if (next) lib.context.assign(targets[k][0], next); }
    catch { /* an image we cannot re-encode keeps its original data */ }
  }
  await progress(targets.length / (targets.length + 1), `${d.name}: writing`);
  const bytes = await lib.save();
  return bytes.length < d.size ? bytes : null;
}

/* ---------- image to PDF ---------- */
async function embedPhoto(out, d) {
  try {
    if (d.mime === 'image/jpeg' && [1, 3, 6, 8].includes(d.exif)) return { img: await out.embedJpg(d.bytes), turn: { 1: 0, 3: 180, 6: 90, 8: 270 }[d.exif] };
    if (d.mime === 'image/png') return { img: await out.embedPng(d.bytes), turn: 0 };
  } catch { /* unusual encoding: fall through and re-encode */ }
  const bmp = await createImageBitmap(new Blob([d.bytes], { type: d.mime }), { imageOrientation: 'from-image' });
  const c = makeCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0);
  const blob = await canvasBlob(c, 'image/jpeg', 0.92);
  return { img: await out.embedJpg(new Uint8Array(await blob.arrayBuffer())), turn: 0 };
}
/* Draw an image into the box (bx, by, bw, bh) turned clockwise by r degrees. */
function drawTurned(page, img, bx, by, bw, bh, r) {
  page.drawImage(img,
    r === 90 ? { x: bx, y: by + bh, width: bh, height: bw, rotate: degrees(-90) }
    : r === 180 ? { x: bx + bw, y: by + bh, width: bw, height: bh, rotate: degrees(180) }
    : r === 270 ? { x: bx + bw, y: by, width: bh, height: bw, rotate: degrees(90) }
    : { x: bx, y: by, width: bw, height: bh });
}

/* ---------- watermark + page number layout (shared by preview and output) ---------- */
function markCenters(W, H, w, hh, o) {
  const th = o.rot * Math.PI / 180, bw = Math.abs(w * Math.cos(th)) + Math.abs(hh * Math.sin(th)), bh = Math.abs(w * Math.sin(th)) + Math.abs(hh * Math.cos(th));
  if (o.tile) {
    const cols = 3, rows = clamp(Math.round(3 * H / W), 2, 5), out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: W * (i + 0.5) / cols, y: H * (j + 0.5) / rows });
    return out;
  }
  const m = 36;
  return [{
    x: o.pos[1] === 'l' ? m + bw / 2 : o.pos[1] === 'r' ? W - m - bw / 2 : W / 2,
    y: o.pos[0] === 't' ? H - m - bh / 2 : o.pos[0] === 'b' ? m + bh / 2 : H / 2,
  }];
}
const NUM_FORMATS = { n: n => `${n}`, page: n => `Page ${n}`, of: (n, t) => `Page ${n} of ${t}`, slash: (n, t) => `${n} / ${t}` };
function numberSpot(W, H, tw, o) {
  return {
    x: o.pos[1] === 'l' ? o.margin : o.pos[1] === 'r' ? W - o.margin - tw : (W - tw) / 2,
    y: o.pos[0] === 'b' ? o.margin : H - o.margin - o.size * 0.72,
  };
}

/* ---------- remove / extract share one selection workspace ---------- */
function selectionTool(rm) {
  return {
    mount(ctx, work, side) {
      const n = ctx.pages.length;
      const picked = () => ctx.pages.map((p, i) => p.sel ? i : -1).filter(i => i >= 0);
      const status = () => {
        const k = picked().length;
        if (rm) ctx.setReady(k > 0 && k < n, k === 0 ? 'Click the pages to remove.' : k === n ? 'A PDF needs at least one page.' : `Removes ${plural(k, 'page')}, keeps ${n - k}.`);
        else ctx.setReady(k > 0, k ? `Extracts ${plural(k, 'page')}.` : 'Click the pages to extract.');
      };
      const inp = ui.text('', (v, el) => {
        const idx = parsePages(v, n); el.classList.toggle('bad', !idx); if (!idx) return;
        const set = new Set(idx); ctx.pages.forEach((p, i) => { p.sel = set.has(i); }); grid.sync(); status();
      }, { placeholder: 'For example 1, 4-6', autocomplete: 'off' });
      const fromGrid = () => { inp.value = formatPages(picked()); inp.classList.remove('bad'); status(); };
      const grid = PageGrid(ctx, work, { select: rm ? 'rm' : 'pick', onChange: fromGrid });
      const setAll = v => { ctx.pages.forEach(p => { p.sel = v; }); grid.sync(); fromGrid(); };
      side.append(
        ui.field(rm ? 'Pages to remove' : 'Pages to extract', inp, 'Click pages, or type numbers and ranges. Shift-click selects a run.'),
        h('div', { class: 'row' }, btn('Select all', () => setAll(true), 'btn small'), btn('Clear', () => setAll(false), 'btn small')),
        !rm && ui.check('Save each page as its own PDF', ctx.o.separate, v => { ctx.o.separate = v; }));
      fromGrid();
    },
    async run(ctx, progress) {
      const d = ctx.docs[0], base = baseName(d.name);
      if (rm) {
        const keep = ctx.pages.filter(p => !p.sel);
        return { title: `Removed ${plural(ctx.pages.length - keep.length, 'page')}`, outputs: [pdfOut(`${base}-trimmed.pdf`, await buildPdf(keep, progress))] };
      }
      const take = ctx.pages.filter(p => p.sel);
      if (!ctx.o.separate) return { title: `Extracted ${plural(take.length, 'page')}`, outputs: [pdfOut(`${base}-extract.pdf`, await buildPdf(take, progress))] };
      const outputs = [], libs = new Map();
      for (let k = 0; k < take.length; k++) {
        await progress(k / take.length, `Page ${take[k].i + 1}`);
        outputs.push(pdfOut(`${base}-page-${pad3(take[k].i + 1)}.pdf`, await buildPdf([take[k]], null, libs)));
      }
      return { title: `Extracted ${plural(take.length, 'page')}`, outputs };
    },
  };
}

const TOOLS = [
  /* ============================ Organize ============================ */
  {
    id: 'merge', name: 'Merge PDF', cat: 'organize', icon: 'merge', accept: 'pdf', multiple: true, cta: 'Merge PDF', busy: 'Merging',
    desc: 'Join several PDFs into one, in the order you set.', keys: 'combine join',
    mount(ctx, work, side) {
      const sync = () => {
        const pages = ctx.docs.reduce((s, d) => s + d.pages, 0);
        ctx.setReady(ctx.docs.length >= 2, ctx.docs.length < 2 ? 'Add at least 2 PDFs to merge.' : `${plural(ctx.docs.length, 'file')}, ${plural(pages, 'page')} in total.`);
      };
      const grid = FileGrid(ctx, work, { sortable: true, onChange: sync });
      const sort = dir => { ctx.docs.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true })); grid.draw(); };
      side.append(h('p', { class: 'muted' }, 'Drag the files into the order you want. The first file becomes the first pages.'),
        ui.group('Sort by name', h('div', { class: 'row' }, btn('A to Z', () => sort(1), 'btn small'), btn('Z to A', () => sort(-1), 'btn small'))));
      sync();
    },
    async run(ctx, progress) {
      const picks = ctx.docs.flatMap(d => Array.from({ length: d.pages }, (_, i) => newPick(d, i)));
      return { title: `Merged ${plural(ctx.docs.length, 'PDF')}`, note: plural(picks.length, 'page'), outputs: [pdfOut('merged.pdf', await buildPdf(picks, progress))] };
    },
  },
  {
    id: 'split', name: 'Split PDF', cat: 'organize', icon: 'split', accept: 'pdf', pages: true, cta: 'Split PDF', busy: 'Splitting',
    desc: 'Cut one PDF into several, by page range or every few pages.', keys: 'separate divide',
    init: () => ({ mode: 'ranges', ranges: null, every: 1, one: false }),
    groups(ctx) {
      const n = ctx.pages.length, o = ctx.o;
      if (o.mode === 'every') { const g = []; for (let i = 0; i < n; i += o.every) g.push({ a: i + 1, b: Math.min(n, i + o.every) }); return g; }
      return o.ranges.filter(r => r.a >= 1 && r.b >= r.a && r.b <= n);
    },
    mount(ctx, work, side) {
      const n = ctx.pages.length, o = ctx.o, tool = this;
      if (!o.ranges) o.ranges = n > 1 ? [{ a: 1, b: Math.ceil(n / 2) }, { a: Math.ceil(n / 2) + 1, b: n }] : [{ a: 1, b: 1 }];
      const grid = PageGrid(ctx, work, {
        badge(p, idx) {
          const k = tool.groups(ctx).findIndex(g => idx + 1 >= g.a && idx + 1 <= g.b);
          if (k < 0) return null;
          return o.mode === 'ranges' && o.one ? { text: 'Keep', color: GROUP_COLORS[0] } : { text: `PDF ${k + 1}`, color: GROUP_COLORS[k % GROUP_COLORS.length] };
        },
      });
      const panel = h('div', { class: 'fld' });
      const sync = () => {
        grid.sync();
        const gs = tool.groups(ctx), count = o.mode === 'ranges' && o.one ? 1 : gs.length;
        ctx.setReady(gs.length > 0, gs.length ? `Makes ${plural(count, 'PDF')}.` : 'Enter a valid page range.');
      };
      const drawPanel = () => {
        panel.replaceChildren();
        if (o.mode === 'every') { panel.append(ui.field('Pages in each PDF', ui.num(o.every, 1, n, v => { o.every = v; sync(); }))); return; }
        o.ranges.forEach((r, k) => panel.append(h('div', { class: 'row' },
          h('span', { class: 'fld-l', style: { minWidth: '58px' } }, `PDF ${k + 1}`),
          ui.num(r.a, 1, n, v => { r.a = v; sync(); }, `PDF ${k + 1} from page`), h('span', { class: 'muted' }, 'to'),
          ui.num(r.b, 1, n, v => { r.b = v; sync(); }, `PDF ${k + 1} to page`),
          o.ranges.length > 1 && tb('x', `Remove range ${k + 1}`, () => { o.ranges.splice(k, 1); drawPanel(); sync(); }))));
        panel.append(h('div', null, btn('Add range', () => {
          const last = o.ranges[o.ranges.length - 1]; o.ranges.push({ a: Math.min(n, last.b + 1), b: n }); drawPanel(); sync();
        }, 'btn small', 'plus')), ui.check('Put all ranges in one PDF', o.one, v => { o.one = v; sync(); }));
      };
      side.append(ui.seg('Split by', [['ranges', 'Page ranges'], ['every', 'Fixed size']], o.mode, v => { o.mode = v; drawPanel(); sync(); }), panel);
      drawPanel(); sync();
    },
    async run(ctx, progress) {
      const base = baseName(ctx.docs[0].name), gs = this.groups(ctx), o = ctx.o;
      if (o.mode === 'ranges' && o.one) {
        const picks = gs.flatMap(g => ctx.pages.slice(g.a - 1, g.b));
        return { title: `Kept ${plural(picks.length, 'page')}`, outputs: [pdfOut(`${base}-split.pdf`, await buildPdf(picks, progress))] };
      }
      const outputs = [], libs = new Map();
      for (let k = 0; k < gs.length; k++) {
        await progress(k / gs.length, `PDF ${k + 1} of ${gs.length}`);
        const g = gs[k], name = g.a === g.b ? `${base}-page-${pad3(g.a)}.pdf` : `${base}-pages-${g.a}-${g.b}.pdf`;
        outputs.push(pdfOut(name, await buildPdf(ctx.pages.slice(g.a - 1, g.b), null, libs)));
      }
      return { title: `Split into ${plural(outputs.length, 'PDF')}`, outputs };
    },
  },
  {
    id: 'remove', name: 'Remove pages', cat: 'organize', icon: 'remove', accept: 'pdf', pages: true, cta: 'Remove pages', busy: 'Removing pages',
    desc: 'Delete the pages you do not need.', keys: 'delete', ...selectionTool(true),
  },
  {
    id: 'extract', name: 'Extract pages', cat: 'organize', icon: 'extract', accept: 'pdf', pages: true, cta: 'Extract pages', busy: 'Extracting pages',
    desc: 'Pull chosen pages out into a new PDF.', keys: 'pick select', init: () => ({ separate: false }), ...selectionTool(false),
  },
  {
    id: 'organize', name: 'Organize PDF', cat: 'organize', icon: 'organize', accept: 'pdf', multiple: true, pages: true, cta: 'Save PDF', busy: 'Building your PDF',
    desc: 'Reorder, rotate, duplicate or delete pages, and add pages from other PDFs.', keys: 'reorder sort arrange',
    mount(ctx, work, side) {
      const sync = () => ctx.setReady(ctx.pages.length > 0, ctx.pages.length ? `${plural(ctx.pages.length, 'page')} in the new PDF.` : 'Add at least one page.');
      const addTile = h('button', { type: 'button', class: 'addtile', onclick: () => pickFiles('pdf', true, ctx.add) }, icon('plus', 22), 'Add PDF');
      const grid = PageGrid(ctx, work, { sortable: true, rotate: true, dup: true, del: true, addTile, onChange: sync, label: (p, idx) => String(idx + 1) });
      side.append(h('p', { class: 'muted' }, 'Drag pages to reorder them. Each page has rotate, duplicate and delete buttons.'),
        h('div', { class: 'row' },
          btn('Add blank page', () => { ctx.pages.push({ blank: true, rot: 0, sel: false }); grid.draw(); sync(); }, 'btn small', 'plus'),
          btn('Reverse order', () => { ctx.pages.reverse(); grid.draw(); }, 'btn small')));
      sync();
    },
    async run(ctx, progress) {
      const base = ctx.docs.length === 1 ? baseName(ctx.docs[0].name) : 'pages';
      return { title: `Saved ${plural(ctx.pages.length, 'page')}`, outputs: [pdfOut(`${base}-organized.pdf`, await buildPdf(ctx.pages, progress))] };
    },
  },

  /* ============================ Optimize ============================ */
  {
    id: 'compress', name: 'Compress PDF', cat: 'optimize', icon: 'compress', accept: 'pdf', multiple: true, cta: 'Compress PDF', busy: 'Compressing',
    desc: 'Shrink the file by re-encoding the images inside it.', keys: 'reduce size smaller shrink optimize',
    init: () => ({ level: 'recommended' }),
    mount(ctx, work, side) {
      const sync = () => ctx.setReady(ctx.docs.length > 0, `${plural(ctx.docs.length, 'file')}, ${fmtBytes(ctx.docs.reduce((s, d) => s + d.size, 0))}.`);
      FileGrid(ctx, work, { onChange: sync });
      side.append(ui.options('Compression level', [
        ['extreme', 'Extreme', 'Smallest file. Images get visibly softer.'],
        ['recommended', 'Recommended', 'Good image quality at a much smaller size.'],
        ['light', 'Light', 'Keeps images close to the original.'],
      ], ctx.o.level, v => { ctx.o.level = v; }),
      h('p', { class: 'fld-h' }, 'Text and line art stay sharp at every level. Only photos and scans are re-encoded.'));
      sync();
    },
    async run(ctx, progress) {
      const outputs = []; let before = 0, after = 0;
      for (let k = 0; k < ctx.docs.length; k++) {
        const d = ctx.docs[k];
        const bytes = await compressPdf(d, ctx.o.level, (f, label) => progress((k + f) / ctx.docs.length, label));
        before += d.size; after += bytes ? bytes.length : d.size;
        outputs.push(pdfOut(`${baseName(d.name)}-compressed.pdf`, bytes || d.bytes, { note: bytes ? `${fmtBytes(d.size)} to ${fmtBytes(bytes.length)}` : 'Already compact' }));
      }
      const pct = Math.round((1 - after / before) * 100);
      return pct >= 1
        ? { title: `${pct}% smaller`, note: `${fmtBytes(before)} down to ${fmtBytes(after)}`, outputs }
        : { title: 'Already compact', note: 'There were no images here that could be made smaller, so the file is unchanged.', outputs };
    },
  },

  /* ============================ Convert ============================ */
  {
    id: 'img2pdf', name: 'Image to PDF', cat: 'convert', icon: 'img2pdf', accept: 'image', multiple: true, cta: 'Convert to PDF', busy: 'Building your PDF',
    desc: 'Turn JPG, PNG or WebP images into one PDF.', keys: 'jpg jpeg png webp photo scan picture',
    init: () => ({ size: 'a4', orient: 'auto', margin: 'small' }),
    mount(ctx, work, side) {
      const o = ctx.o;
      const sync = () => ctx.setReady(ctx.docs.length > 0, `${plural(ctx.docs.length, 'image')}, one per page.`);
      FileGrid(ctx, work, { sortable: true, rotate: true, onChange: sync, meta: d => `${d.w} × ${d.h} px` });
      const more = h('div', { class: 'fld', style: { gap: '20px' } });
      const drawMore = () => {
        more.replaceChildren();
        if (o.size === 'fit') return;
        more.append(
          ui.group('Orientation', ui.seg('Orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], o.orient, v => { o.orient = v; })),
          ui.group('Margin', ui.seg('Margin', [['none', 'None'], ['small', 'Small'], ['large', 'Large']], o.margin, v => { o.margin = v; })));
      };
      side.append(h('p', { class: 'muted' }, 'Drag the images into page order.'),
        ui.group('Page size', ui.seg('Page size', [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Same as image']], o.size, v => { o.size = v; drawMore(); })), more);
      drawMore(); sync();
    },
    async run(ctx, progress) {
      const o = ctx.o, out = await PDFDocument.create();
      for (let k = 0; k < ctx.docs.length; k++) {
        const d = ctx.docs[k];
        await progress(k / ctx.docs.length, d.name);
        const { img, turn } = await embedPhoto(out, d);
        const r = norm(turn + d.rot), side = r === 90 || r === 270;
        const iw = side ? img.height : img.width, ih = side ? img.width : img.height;
        let pw, ph, m = 0;
        if (o.size === 'fit') { pw = iw * 0.75; ph = ih * 0.75; }
        else {
          const [A, B] = o.size === 'a4' ? [595.28, 841.89] : [612, 792];
          const land = o.orient === 'landscape' || (o.orient === 'auto' && iw > ih);
          [pw, ph] = land ? [B, A] : [A, B]; m = { none: 0, small: 20, large: 48 }[o.margin];
        }
        const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih), bw = iw * s, bh = ih * s;
        drawTurned(out.addPage([pw, ph]), img, (pw - bw) / 2, (ph - bh) / 2, bw, bh, r);
      }
      await progress(0.95, 'Writing the PDF');
      const name = ctx.docs.length === 1 ? `${baseName(ctx.docs[0].name)}.pdf` : 'images.pdf';
      return { title: `Converted ${plural(ctx.docs.length, 'image')}`, outputs: [pdfOut(name, await out.save())] };
    },
  },
  {
    id: 'pdf2jpg', name: 'PDF to JPG', cat: 'convert', icon: 'pdf2jpg', accept: 'pdf', pages: true, cta: 'Convert pages', busy: 'Drawing pages',
    desc: 'Save each page as a JPG or PNG image.', keys: 'image png picture export',
    init: () => ({ format: 'jpg', quality: 'standard' }),
    mount(ctx, work, side) {
      const o = ctx.o, n = ctx.pages.length;
      PageGrid(ctx, work, {});
      side.append(
        ui.group('Image format', ui.seg('Image format', [['jpg', 'JPG'], ['png', 'PNG']], o.format, v => { o.format = v; })),
        ui.options('Resolution', [['standard', 'Standard', 'About 110 dpi. Good for screens and email.'], ['high', 'High', 'About 220 dpi. Good for print and zooming in.']], o.quality, v => { o.quality = v; }));
      ctx.setReady(true, n === 1 ? 'Makes 1 image.' : `Makes ${n} images in a ZIP.`);
    },
    async run(ctx, progress) {
      const d = ctx.docs[0], o = ctx.o, base = baseName(d.name), outputs = [];
      const scale = o.quality === 'high' ? 220 / 72 : 110 / 72;
      for (let n = 1; n <= d.pages; n++) {
        await progress((n - 1) / d.pages, `Page ${n} of ${d.pages}`);
        const c = await renderPage(d, n, scale);
        outputs.push({ name: `${base}-page-${pad3(n)}.${o.format}`, blob: await canvasBlob(c, o.format === 'png' ? 'image/png' : 'image/jpeg', 0.9) });
        c.width = c.height = 0;
      }
      return { title: `Converted ${plural(d.pages, 'page')}`, outputs };
    },
  },

  /* ============================== Edit ============================== */
  {
    id: 'rotate', name: 'Rotate PDF', cat: 'edit', icon: 'rotate', accept: 'pdf', pages: true, cta: 'Rotate PDF', busy: 'Rotating',
    desc: 'Turn every page, or only the ones that are sideways.', keys: 'turn orientation landscape portrait',
    mount(ctx, work, side) {
      const sync = () => {
        const k = ctx.pages.filter(p => norm(p.rot)).length;
        ctx.setReady(k > 0, k ? `Turns ${plural(k, 'page')}.` : 'Rotate at least one page.');
      };
      const grid = PageGrid(ctx, work, { rotate: true, onChange: sync });
      const all = by => { ctx.pages.forEach(p => { p.rot = by ? p.rot + by : 0; }); grid.sync(); sync(); };
      side.append(h('p', { class: 'muted' }, 'Use the button on a page to turn just that one.'),
        ui.group('All pages', h('div', { class: 'row' }, btn('Left', () => all(-90), 'btn small', 'ccw'), btn('Right', () => all(90), 'btn small', 'cw'), btn('Reset', () => all(0), 'btn small'))));
      sync();
    },
    async run(ctx) {
      const d = ctx.docs[0], lib = await loadLib(d);
      ctx.pages.forEach((p, i) => { if (norm(p.rot)) { const pg = lib.getPage(i); pg.setRotation(degrees(norm(pg.getRotation().angle + p.rot))); } });
      return { title: `Rotated ${plural(ctx.pages.filter(p => norm(p.rot)).length, 'page')}`, outputs: [pdfOut(`${baseName(d.name)}-rotated.pdf`, await lib.save())] };
    },
  },
  {
    id: 'pagenum', name: 'Page numbers', cat: 'edit', icon: 'pagenum', accept: 'pdf', cta: 'Add page numbers', busy: 'Numbering pages',
    desc: 'Stamp page numbers where you want them.', keys: 'number numbering footer header',
    init: () => ({ pos: 'bc', margin: 28, first: 1, from: 1, to: 0, style: 'n', size: 11, color: '#111111' }),
    mount(ctx, work, side) {
      const o = ctx.o, n = ctx.docs[0].pages;
      const paint = () => pv.paint((g, W, H) => {
        const [a, b] = spanOf(o, n);
        if (pv.n < a || pv.n > b) return;
        const text = NUM_FORMATS[o.style](pv.n - a + o.first, b - a + o.first);
        g.font = `${o.size}px Helvetica, Arial, sans-serif`; g.fillStyle = o.color; g.textBaseline = 'alphabetic';
        const at = numberSpot(W, H, g.measureText(text).width, o);
        g.fillText(text, at.x, H - at.y);
      });
      const pv = PagePreview(ctx, work, { onShow: paint });
      const sel = h('select', { class: 'inp', 'aria-label': 'Number format' },
        ...[['n', '1, 2, 3'], ['page', 'Page 1'], ['of', 'Page 1 of 9'], ['slash', '1 / 9']].map(([v, t]) => h('option', { value: v, selected: v === o.style }, t)));
      sel.addEventListener('change', () => { o.style = sel.value; paint(); });
      side.append(
        h('div', { class: 'row', style: { gap: '22px', alignItems: 'flex-start' } },
          ui.group('Position', ui.pos('Position', 'tb', o.pos, v => { o.pos = v; paint(); })),
          ui.field('Text size', ui.num(o.size, 6, 48, v => { o.size = v; paint(); })),
          ui.field('Colour', ui.color(o.color, v => { o.color = v; paint(); }))),
        ui.field('Format', sel),
        ui.slider('Distance from the edge', o.margin, 10, 90, 1, v => `${Math.round(v / 72 * 25.4)} mm`, v => { o.margin = v; paint(); }),
        ui.pageSpan(ctx, paint),
        ui.field('First number', ui.num(o.first, 0, 9999, v => { o.first = v; paint(); })));
      ctx.setReady(true, '');
    },
    async run(ctx, progress) {
      const d = ctx.docs[0], o = ctx.o, lib = await loadLib(d), pages = lib.getPages(), [a, b] = spanOf(o, pages.length);
      const font = await lib.embedFont(StandardFonts.Helvetica), color = hexRgb(o.color);
      for (let i = a; i <= b; i++) {
        if (i % 50 === 0) await progress((i - a) / (b - a + 1), `Page ${i}`);
        const page = pages[i - 1], f = frameOf(page), text = NUM_FORMATS[o.style](i - a + o.first, b - a + o.first);
        const at = numberSpot(f.W, f.H, font.widthOfTextAtSize(text, o.size), o), P = f.toPdf(at.x, at.y);
        page.drawText(text, { x: P.x, y: P.y, size: o.size, font, color, rotate: degrees(f.angle) });
      }
      return { title: `Numbered ${plural(b - a + 1, 'page')}`, outputs: [pdfOut(`${baseName(d.name)}-numbered.pdf`, await lib.save())] };
    },
  },
  {
    id: 'watermark', name: 'Watermark', cat: 'edit', icon: 'watermark', accept: 'pdf', cta: 'Add watermark', busy: 'Stamping pages',
    desc: 'Stamp text or an image across the pages.', keys: 'stamp logo confidential draft',
    init: () => ({ mode: 'text', text: 'CONFIDENTIAL', size: 54, color: '#c2362c', bold: true, pos: 'mc', tile: false, rot: 45, opacity: 0.3, from: 1, to: 0, image: null, imgW: 0.35 }),
    mount(ctx, work, side) {
      const o = ctx.o, n = ctx.docs[0].pages;
      const dims = (g, W) => {
        if (o.mode === 'image') return o.image ? { w: W * o.imgW, h: W * o.imgW * o.image.h / o.image.w } : null;
        g.font = `${o.bold ? 700 : 400} ${o.size}px Helvetica, Arial, sans-serif`;
        return o.text.trim() ? { w: g.measureText(o.text).width, h: o.size * 0.7 } : null;
      };
      const paint = () => {
        ctx.setReady(o.mode === 'text' ? !!o.text.trim() : !!o.image, o.mode === 'text' ? (o.text.trim() ? '' : 'Type the watermark text.') : (o.image ? '' : 'Choose an image to stamp.'));
        pv.paint((g, W, H) => {
          const [a, b] = spanOf(o, n), m = dims(g, W);
          if (!m || pv.n < a || pv.n > b) return;
          for (const c of markCenters(W, H, m.w, m.h, o)) {
            g.save(); g.translate(c.x, H - c.y); g.rotate(-o.rot * Math.PI / 180); g.globalAlpha = o.opacity;
            if (o.mode === 'text') { g.fillStyle = o.color; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(o.text, 0, m.h / 2); }
            else g.drawImage(o.image.el, -m.w / 2, -m.h / 2, m.w, m.h);
            g.restore();
          }
        });
      };
      const pv = PagePreview(ctx, work, { onShow: paint });
      const panel = h('div', { class: 'fld', style: { gap: '18px' } });
      const posPicker = ui.pos('Position', 'tmb', o.pos, v => { o.pos = v; paint(); });
      const lockPos = () => posPicker.querySelectorAll('button').forEach(b => { b.disabled = o.tile; });
      const drawPanel = () => {
        panel.replaceChildren();
        if (o.mode === 'text') panel.append(
          ui.field('Text', ui.text(o.text, v => { o.text = v; paint(); }, { maxlength: '80' })),
          h('div', { class: 'row', style: { gap: '22px', alignItems: 'flex-start' } },
            ui.field('Text size', ui.num(o.size, 8, 200, v => { o.size = v; paint(); })),
            ui.field('Colour', ui.color(o.color, v => { o.color = v; paint(); }))),
          ui.check('Bold', o.bold, v => { o.bold = v; paint(); }));
        else panel.append(
          h('div', { class: 'row' }, btn(o.image ? 'Change image' : 'Choose image', () => pickFiles('image', false, async files => {
            try {
              const dd = await makeDoc(files[0]);
              const bmp = await createImageBitmap(new Blob([dd.bytes], { type: dd.mime }), { imageOrientation: 'from-image' });
              const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = makeCanvas(bmp.width * s, bmp.height * s);
              c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
              const url = c.toDataURL('image/png');
              o.image = { url, w: c.width, h: c.height, el: await loadImage(url), name: dd.name };
              drawPanel(); paint();
            } catch (e) { toast(explain(e), 'err'); }
          }), 'btn', 'upload'), o.image && h('span', { class: 'fld-h' }, o.image.name)),
          ui.slider('Width on the page', o.imgW, 0.08, 1, 0.01, v => `${Math.round(v * 100)}%`, v => { o.imgW = v; paint(); }));
      };
      side.append(
        ui.seg('Watermark type', [['text', 'Text'], ['image', 'Image']], o.mode, v => { o.mode = v; drawPanel(); paint(); }), panel,
        h('div', { class: 'row', style: { gap: '22px', alignItems: 'flex-start' } },
          ui.group('Position', posPicker),
          h('div', { class: 'fld', style: { flex: '1', minWidth: '150px' } }, ui.check('Repeat across the page', o.tile, v => { o.tile = v; lockPos(); paint(); }))),
        ui.slider('Angle', o.rot, -90, 90, 5, v => `${v}°`, v => { o.rot = v; paint(); }),
        ui.slider('Opacity', o.opacity, 0.05, 1, 0.05, v => `${Math.round(v * 100)}%`, v => { o.opacity = v; paint(); }),
        ui.pageSpan(ctx, paint));
      drawPanel(); lockPos(); paint();
    },
    async run(ctx, progress) {
      const d = ctx.docs[0], o = ctx.o, lib = await loadLib(d), pages = lib.getPages(), [a, b] = spanOf(o, pages.length);
      let font = null, img = null, size;
      if (o.mode === 'text') {
        const f = await lib.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
        if (canEncode(f, o.text)) { font = f; const w = f.widthOfTextAtSize(o.text, o.size); size = () => ({ w, h: o.size * 0.7 }); }
        else { const t = textImage(o.text, o.size, o.color, o.bold ? 700 : 400); img = await lib.embedPng(dataUrlBytes(t.url)); size = () => ({ w: t.w, h: t.h }); }
      } else { img = await lib.embedPng(dataUrlBytes(o.image.url)); size = W => ({ w: W * o.imgW, h: W * o.imgW * o.image.h / o.image.w }); }
      const th = o.rot * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th), color = hexRgb(o.color);
      for (let i = a; i <= b; i++) {
        if (i % 25 === 0) await progress((i - a) / (b - a + 1), `Page ${i}`);
        const page = pages[i - 1], f = frameOf(page), { w, h: hh } = size(f.W);
        for (const c of markCenters(f.W, f.H, w, hh, o)) {
          const P = f.toPdf(c.x - w / 2 * cos + hh / 2 * sin, c.y - w / 2 * sin - hh / 2 * cos), rotate = degrees(o.rot + f.angle);
          if (font) page.drawText(o.text, { x: P.x, y: P.y, size: o.size, font, color, opacity: o.opacity, rotate });
          else page.drawImage(img, { x: P.x, y: P.y, width: w, height: hh, opacity: o.opacity, rotate });
        }
      }
      return { title: `Watermarked ${plural(b - a + 1, 'page')}`, outputs: [pdfOut(`${baseName(d.name)}-watermarked.pdf`, await lib.save())] };
    },
  },
  {
    id: 'crop', name: 'Crop PDF', cat: 'edit', icon: 'crop', accept: 'pdf', cta: 'Crop PDF', busy: 'Cropping',
    desc: 'Trim the margins of one page or all of them.', keys: 'trim margins cut',
    init: () => ({ box: { l: 0.06, t: 0.06, r: 0.94, b: 0.94 }, all: true }),
    mount(ctx, work, side) {
      const o = ctx.o, sizeNote = h('p', { class: 'fld-h' });
      const el = h('div', { class: 'crop', role: 'group', 'aria-label': 'Crop area. Drag the box or its handles.' });
      for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) el.append(h('i', {
        'data-k': k, style: {
          left: k.includes('w') ? '-9px' : k.includes('e') ? 'calc(100% - 7px)' : 'calc(50% - 8px)',
          top: k.includes('n') ? '-9px' : k.includes('s') ? 'calc(100% - 7px)' : 'calc(50% - 8px)',
          cursor: (k === 'n' || k === 's') ? 'ns-resize' : (k === 'e' || k === 'w') ? 'ew-resize' : (k === 'nw' || k === 'se') ? 'nwse-resize' : 'nesw-resize',
        },
      }));
      const place = () => {
        const b = o.box;
        Object.assign(el.style, { left: b.l * 100 + '%', top: b.t * 100 + '%', width: (b.r - b.l) * 100 + '%', height: (b.b - b.t) * 100 + '%' });
        const mm = v => Math.round(v / 72 * 25.4);
        sizeNote.textContent = pv.W ? `New page size: ${mm((b.r - b.l) * pv.W)} × ${mm((b.b - b.t) * pv.H)} mm` : '';
        const full = b.l < 0.002 && b.t < 0.002 && b.r > 0.998 && b.b > 0.998;
        ctx.setReady(!full, full ? 'Drag the handles inward to crop.' : '');
      };
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        const k = (e.target.dataset && e.target.dataset.k) || 'move', r = pv.pageEl.getBoundingClientRect(), from = { x: e.clientX, y: e.clientY, b: { ...o.box } }, MIN = 0.05;
        el.setPointerCapture(e.pointerId);
        const move = ev => {
          const dx = (ev.clientX - from.x) / r.width, dy = (ev.clientY - from.y) / r.height, b = { ...from.b };
          if (k === 'move') { const w = b.r - b.l, hh = b.b - b.t; b.l = clamp(b.l + dx, 0, 1 - w); b.t = clamp(b.t + dy, 0, 1 - hh); b.r = b.l + w; b.b = b.t + hh; }
          else {
            if (k.includes('w')) b.l = clamp(b.l + dx, 0, b.r - MIN); if (k.includes('e')) b.r = clamp(b.r + dx, b.l + MIN, 1);
            if (k.includes('n')) b.t = clamp(b.t + dy, 0, b.b - MIN); if (k.includes('s')) b.b = clamp(b.b + dy, b.t + MIN, 1);
          }
          o.box = b; place();
        };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
      const pv = PagePreview(ctx, work, { onShow: place });
      pv.over.append(el);
      side.append(h('p', { class: 'muted' }, 'Drag the yellow box, or its handles, to mark the part of the page to keep.'),
        ui.group('Apply to', ui.seg('Apply to', [['all', 'All pages'], ['one', 'This page only']], o.all ? 'all' : 'one', v => { o.all = v === 'all'; })),
        h('div', { class: 'row' }, btn('Reset to full page', () => { o.box = { l: 0, t: 0, r: 1, b: 1 }; place(); }, 'btn small')), sizeNote);
      place();
    },
    async run(ctx) {
      const d = ctx.docs[0], o = ctx.o, lib = await loadLib(d), pages = lib.getPages();
      const list = o.all ? pages : [pages[(o.viewPage || 1) - 1]];
      for (const page of list) {
        const f = frameOf(page), p0 = f.toPdf(o.box.l * f.W, (1 - o.box.b) * f.H), p1 = f.toPdf(o.box.r * f.W, (1 - o.box.t) * f.H);
        const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), hh = Math.abs(p1.y - p0.y);
        page.setMediaBox(x, y, w, hh); page.setCropBox(x, y, w, hh);
      }
      return { title: `Cropped ${plural(list.length, 'page')}`, outputs: [pdfOut(`${baseName(d.name)}-cropped.pdf`, await lib.save())] };
    },
  },

  /* ============================ Security ============================ */
  {
    id: 'protect', name: 'Protect PDF', cat: 'security', icon: 'protect', accept: 'pdf', cta: 'Protect PDF', busy: 'Encrypting',
    desc: 'Lock a PDF with a password, using AES-256 encryption.', keys: 'password encrypt lock secure',
    init: () => ({ pw: '', pw2: '', print: true, copy: true }),
    mount(ctx, work, side) {
      const o = ctx.o;
      FileGrid(ctx, work, {});
      const sync = () => ctx.setReady(!!o.pw && o.pw === o.pw2, !o.pw ? 'Enter a password.' : o.pw !== o.pw2 ? 'The two passwords do not match yet.' : 'Keep this password safe. It cannot be recovered.');
      const a = h('input', { type: 'password', class: 'inp', autocomplete: 'new-password', value: o.pw });
      const b = h('input', { type: 'password', class: 'inp', autocomplete: 'new-password', value: o.pw2 });
      a.addEventListener('input', () => { o.pw = a.value; sync(); }); b.addEventListener('input', () => { o.pw2 = b.value; sync(); });
      side.append(ui.field('Password', a), ui.field('Repeat the password', b),
        ui.check('Show passwords', false, v => { a.type = b.type = v ? 'text' : 'password'; }),
        ui.group('People who open it may', ui.check('Print the document', o.print, v => { o.print = v; }), ui.check('Copy text and images', o.copy, v => { o.copy = v; })));
      sync();
    },
    async run(ctx) {
      const d = ctx.docs[0], o = ctx.o, lib = await loadLib(d), open = o.print && o.copy;
      const ownerPassword = open ? o.pw : Array.from(crypto.getRandomValues(new Uint8Array(18)), v => v.toString(36)).join('');
      await lib.encrypt({
        userPassword: o.pw, ownerPassword,
        permissions: { printing: o.print ? 'highResolution' : undefined, copying: o.copy, modifying: open, documentAssembly: open, annotating: true, fillingForms: true, contentAccessibility: true },
      });
      return { title: 'Protected with a password', outputs: [pdfOut(`${baseName(d.name)}-protected.pdf`, await lib.save())] };
    },
  },
  {
    id: 'unlock', name: 'Unlock PDF', cat: 'security', icon: 'unlock', accept: 'pdf', cta: 'Unlock PDF', busy: 'Removing the password',
    desc: 'Remove the password from a PDF you are able to open.', keys: 'password decrypt remove restrictions',
    mount(ctx, work, side) {
      const d = ctx.docs[0];
      FileGrid(ctx, work, { meta: x => x.locked ? 'Locked, password accepted' : 'Not locked' });
      side.append(h('p', { class: 'muted' }, 'You will be asked for the password when you add the file. The copy you save opens without one and has no print or copy restrictions.'));
      ctx.setReady(!!d.locked, d.locked ? '' : 'This PDF has no password, so there is nothing to remove.');
    },
    async run(ctx) {
      const d = ctx.docs[0], lib = await loadLib(d);
      return { title: 'Password removed', outputs: [pdfOut(`${baseName(d.name)}-unlocked.pdf`, await lib.save())] };
    },
  },
  {
    id: 'sign', name: 'Sign PDF', cat: 'security', icon: 'sign', accept: 'pdf', cta: 'Sign PDF', busy: 'Placing your signature',
    desc: 'Draw or type your signature and place it on the page.', keys: 'signature esign initials date fill',
    init: () => ({ sig: null, stamps: [] }),
    mount(ctx, work, side) {
      const o = ctx.o;
      const sigBox = h('div', { class: 'sigbox' });
      const sync = () => {
        const pagesUsed = new Set(o.stamps.map(s => s.page)).size;
        ctx.setReady(o.stamps.length > 0, o.stamps.length ? `${plural(o.stamps.length, 'item')} on ${plural(pagesUsed, 'page')}.` : 'Place a signature or some text on the page.');
        sigBox.replaceChildren(o.sig ? h('img', { src: o.sig.url, alt: 'Your signature' }) : h('span', { class: 'muted' }, 'No signature yet'));
        placeBtn.hidden = !o.sig; makeBtn.lastChild.textContent = o.sig ? 'Change signature' : 'Create signature';
      };
      function stampEl(s) {
        const el = h('div', { class: 'stamp' }, h('img', { src: s.url, alt: '' }),
          tb('x', 'Remove', () => { o.stamps.splice(o.stamps.indexOf(s), 1); el.remove(); sync(); }, 'del'), h('i', { 'data-k': 'size' }));
        const put = () => Object.assign(el.style, { left: s.x * 100 + '%', top: s.y * 100 + '%', width: s.w * 100 + '%', height: s.h * 100 + '%' });
        put();
        el.addEventListener('pointerdown', e => {
          if (e.target.closest('.tb')) return;
          e.preventDefault();
          pv.over.querySelectorAll('.stamp.on').forEach(x => x.classList.remove('on')); el.classList.add('on');
          const resize = e.target.dataset && e.target.dataset.k === 'size', r = pv.pageEl.getBoundingClientRect(), from = { x: e.clientX, y: e.clientY, s: { ...s } };
          el.setPointerCapture(e.pointerId);
          const move = ev => {
            const dx = (ev.clientX - from.x) / r.width, dy = (ev.clientY - from.y) / r.height;
            if (resize) { const ratio = from.s.h / from.s.w, w = clamp(from.s.w + dx, 0.04, Math.min(1 - s.x, (1 - s.y) / ratio)); s.w = w; s.h = w * ratio; }
            else { s.x = clamp(from.s.x + dx, 0, 1 - s.w); s.y = clamp(from.s.y + dy, 0, 1 - s.h); }
            put();
          };
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
        return el;
      }
      const drawStamps = () => { pv.over.querySelectorAll('.stamp').forEach(x => x.remove()); o.stamps.filter(s => s.page === pv.n).forEach(s => pv.over.append(stampEl(s))); };
      const pv = PagePreview(ctx, work, { onShow: drawStamps });
      /* widthPt: how wide the item should be on the page, in points */
      const addStamp = (img, widthPt, y = 0.74) => {
        if (!pv.W) return;
        const w = clamp(widthPt / pv.W, 0.04, 0.9), hh = Math.min(0.9, w * pv.W * (img.h / img.w) / pv.H);
        const k = o.stamps.filter(s => s.page === pv.n).length;
        o.stamps.push({ page: pv.n, url: img.url, x: clamp(0.94 - w - k * 0.03, 0, 1 - w), y: clamp(y + k * 0.03, 0, 1 - hh), w, h: hh });
        drawStamps(); sync();
      };
      const placeSig = () => addStamp(o.sig, Math.min(170, pv.W * 0.32));
      const addText = text => {
        const t = textImage(text, 13, '#14181f', 500), c = trimCanvas(t.canvas);
        if (c) addStamp({ url: c.toDataURL('image/png'), w: c.width, h: c.height }, c.width / 4, 0.84);
      };
      const makeBtn = btn('Create signature', async () => { const s = await signatureDialog(); if (s) { o.sig = s; sync(); placeSig(); } }, 'btn', 'sign');
      const placeBtn = btn('Place on this page', placeSig, 'btn', 'plus');
      const textInp = ui.text('', () => {}, { placeholder: 'Name, title, place…', 'aria-label': 'Text to add' });
      const pushText = () => { const v = textInp.value.trim(); if (!v) return toast('Type the text to add first.'); addText(v); textInp.value = ''; };
      textInp.addEventListener('keydown', e => { if (e.key === 'Enter') pushText(); });
      side.append(
        ui.group('Signature', sigBox, h('div', { class: 'row' }, makeBtn, placeBtn)),
        ui.group('Text and date', textInp, h('div', { class: 'row' }, btn('Add text', pushText, 'btn small', 'plus'),
          btn('Add today’s date', () => addText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })), 'btn small', 'plus'))),
        h('p', { class: 'fld-h' }, 'Drag an item to move it. Drag its blue corner to resize. Use the arrows under the page to sign other pages.'));
      sync();
    },
    async run(ctx) {
      const d = ctx.docs[0], lib = await loadLib(d), cache = new Map();
      for (const s of ctx.o.stamps) {
        if (!cache.has(s.url)) cache.set(s.url, await lib.embedPng(dataUrlBytes(s.url)));
        const page = lib.getPage(s.page - 1), f = frameOf(page), P = f.toPdf(s.x * f.W, (1 - s.y - s.h) * f.H);
        page.drawImage(cache.get(s.url), { x: P.x, y: P.y, width: s.w * f.W, height: s.h * f.H, rotate: degrees(f.angle) });
      }
      return { title: 'Signed', note: plural(ctx.o.stamps.length, 'item') + ' placed', outputs: [pdfOut(`${baseName(d.name)}-signed.pdf`, await lib.save())] };
    },
  },
];
