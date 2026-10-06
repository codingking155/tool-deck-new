/* Sheaf: components.js
   File grid, page grid, page preview, sidebar controls, signature dialog.
   Plain scripts loaded in order by index.html; they share one top-level scope. */
'use strict';
/* =====================================================================
   5. Workspace components
===================================================================== */
const ACCEPT = { any: 'application/pdf,.pdf,image/*', pdf: 'application/pdf,.pdf', image: 'image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp' };
function pickFiles(accept, multiple, cb) {
  const inp = h('input', { type: 'file', accept: ACCEPT[accept], multiple: !!multiple, style: { display: 'none' } });
  inp.addEventListener('change', () => { const files = [...inp.files]; inp.remove(); if (files.length) cb(files); });
  document.body.append(inp); inp.click();
}
const newPick = (doc, i) => ({ doc, i, rot: 0, sel: false });

/* One card per file. Drag to reorder, remove, and (for images) rotate. */
function FileGrid(ctx, host, opt = {}) {
  const el = h('div', { class: 'grid files' });
  host.append(el);
  const changed = () => opt.onChange && opt.onChange();
  function card(d) {
    const img = h('img', { class: 'pg-img', alt: '', draggable: false, hidden: true, style: { transform: `rotate(${d.rot}deg)` } });
    const ph = h('div', { class: 'pg-ph' });
    const c = h('div', { class: 'pg' + (opt.sortable ? ' drag' : '') },
      h('div', { class: 'pg-stage' }, ph, img),
      h('div', { class: 'pg-tools' },
        opt.rotate && tb('cw', 'Rotate right', () => { d.rot += 90; img.style.transform = `rotate(${d.rot}deg)`; changed(); }),
        tb('x', `Remove ${d.name}`, () => {
          ctx.docs.splice(ctx.docs.indexOf(d), 1); closeDoc(d); c.remove();
          if (!ctx.docs.length) ctx.reset(); else changed();
        }, 'del')),
      h('span', { class: 'pg-name', title: d.name }, d.name),
      h('span', { class: 'pg-num' }, opt.meta ? opt.meta(d) : d.kind === 'pdf' ? `${plural(d.pages, 'page')}, ${fmtBytes(d.size)}` : fmtBytes(d.size)));
    c._load = async () => { const url = await thumb(d, 1); if (url) { img.src = url; img.hidden = false; ph.remove(); } };
    lazy.observe(c);
    return c;
  }
  function draw() {
    el.replaceChildren(...ctx.docs.map(card));
    if (ctx.tool.multiple) el.append(h('button', { type: 'button', class: 'addtile', onclick: () => pickFiles(ctx.tool.accept, true, ctx.add) }, icon('plus', 22), 'Add files'));
  }
  if (opt.sortable) Sortable.create(el, {
    animation: 160, draggable: '.pg', filter: '.tb', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
    onEnd: e => {
      if (e.oldDraggableIndex === e.newDraggableIndex) return;
      const [m] = ctx.docs.splice(e.oldDraggableIndex, 1); ctx.docs.splice(e.newDraggableIndex, 0, m); changed();
    },
  });
  draw();
  return { el, draw };
}

/* One cell per page pick in ctx.pages.
   opt.select: 'pick' | 'rm' turns cells into toggles (shift-click selects a run).
   opt.sortable / rotate / dup / del add direct manipulation. opt.badge(p, idx) labels a page. */
function PageGrid(ctx, host, opt = {}) {
  const el = h('div', { class: 'grid' });
  host.append(el);
  const mode = opt.select;
  const changed = () => opt.onChange && opt.onChange();
  let lastClicked = null;

  function cell(p) {
    const img = h('img', { class: 'pg-img', alt: '', draggable: false, hidden: true });
    const ph = p.blank ? h('div', { class: 'pg-blank' }, 'Blank') : h('div', { class: 'pg-ph' });
    const badge = h('span', { class: 'pg-badge' }, mode === 'pick' && icon('check', 14), mode === 'rm' && icon('x', 14));
    const num = h('span', { class: 'pg-num' });
    const hasTools = opt.rotate || opt.dup || opt.del;
    const c = h(mode ? 'button' : 'div', { class: `pg ${mode || ''}${opt.sortable ? ' drag' : ''}`, type: mode ? 'button' : null },
      h('div', { class: 'pg-stage' }, ph, img),
      hasTools && h('div', { class: 'pg-tools' },
        opt.rotate && !p.blank && tb('cw', 'Rotate right', () => { p.rot += 90; c._sync(); changed(); }),
        opt.dup && tb('copy', 'Duplicate page', () => {
          const q = { ...p, sel: false }; ctx.pages.splice(ctx.pages.indexOf(p) + 1, 0, q); c.after(cell(q)); syncAll(); changed();
        }),
        opt.del && tb('trash', 'Delete page', () => { ctx.pages.splice(ctx.pages.indexOf(p), 1); c.remove(); syncAll(); changed(); }, 'del')),
      badge, num);
    c._p = p;
    c._load = async () => { if (p.blank) return; const url = await thumb(p.doc, p.i + 1); if (url) { img.src = url; img.hidden = false; ph.remove(); } };
    c._sync = (idx = ctx.pages.indexOf(p)) => {
      img.style.transform = `rotate(${p.rot}deg)`;
      num.textContent = opt.label ? opt.label(p, idx) : String(p.i + 1);
      if (mode) { c.classList.toggle('is-sel', p.sel); c.setAttribute('aria-pressed', String(p.sel)); c.setAttribute('aria-label', `Page ${p.i + 1}`); }
      if (opt.badge) {
        const b = opt.badge(p, idx);
        c.classList.toggle('has-badge', !!b); c.classList.toggle('dim', !b);
        if (b) { badge.textContent = b.text; badge.style.background = b.color; }
      }
    };
    if (mode) c.addEventListener('click', e => {
      const idx = ctx.pages.indexOf(p);
      if (e.shiftKey && lastClicked != null && lastClicked !== idx) {
        const [a, b] = lastClicked < idx ? [lastClicked, idx] : [idx, lastClicked];
        for (let i = a; i <= b; i++) ctx.pages[i].sel = true;
      } else p.sel = !p.sel;
      lastClicked = idx; syncAll(); changed();
    });
    lazy.observe(c);
    return c;
  }
  function syncAll() { [...el.querySelectorAll('.pg')].forEach((c, i) => c._sync(i)); }
  function draw() {
    el.replaceChildren(...ctx.pages.map(cell));
    if (opt.addTile) el.append(opt.addTile);
    syncAll();
  }
  if (opt.sortable) Sortable.create(el, {
    animation: 160, draggable: '.pg', filter: '.tb', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
    onEnd: e => {
      if (e.oldDraggableIndex === e.newDraggableIndex) return;
      const [m] = ctx.pages.splice(e.oldDraggableIndex, 1); ctx.pages.splice(e.newDraggableIndex, 0, m); syncAll(); changed();
    },
  });
  draw();
  return { el, draw, sync: syncAll };
}

/* One page, large, with a layer on top for live previews and direct manipulation. */
function PagePreview(ctx, host, opt = {}) {
  const d = ctx.docs[0];
  const canvas = h('canvas');
  const over = h('div', { class: 'pv-over' });
  const pageEl = h('div', { class: 'pv-page' }, canvas, over);
  const info = h('span');
  const prev = tb('left', 'Previous page', () => self.show(self.n - 1));
  const next = tb('right', 'Next page', () => self.show(self.n + 1));
  const root = h('div', { class: 'pv' }, h('div', { class: 'pv-stage' }, pageEl), h('div', { class: 'pv-pager' }, prev, info, next));
  host.append(root);
  let token = 0, paintCanvas = null;
  const self = {
    n: ctx.o.viewPage || 1, W: 0, H: 0, scale: 1, over, pageEl,
    async show(n) {
      self.n = ctx.o.viewPage = clamp(n, 1, d.pages);
      const my = ++token;
      let base, s, c;
      try {
        base = (await d.js.getPage(self.n)).getViewport({ scale: 1 });
        const availW = Math.max(180, root.clientWidth - 40), availH = Math.max(300, Math.min(window.innerHeight - 190, 1100));
        s = Math.min(availW / base.width, availH / base.height, 2.2);
        c = await renderPage(d, self.n, s * Math.min(window.devicePixelRatio || 1, 2));
      } catch { return; }   // the document was closed while drawing
      if (my !== token || !root.isConnected) return;
      canvas.width = c.width; canvas.height = c.height; canvas.getContext('2d').drawImage(c, 0, 0);
      Object.assign(self, { W: base.width, H: base.height, scale: s });
      pageEl.style.width = base.width * s + 'px'; pageEl.style.height = base.height * s + 'px';
      info.textContent = `Page ${self.n} of ${d.pages}`;
      prev.disabled = self.n <= 1; next.disabled = self.n >= d.pages;
      opt.onShow && opt.onShow(self);
    },
    /* Draw on the layer in page points, origin at the top-left of the visible page. */
    paint(fn) {
      if (!self.W) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!paintCanvas) { paintCanvas = h('canvas'); over.prepend(paintCanvas); }
      paintCanvas.width = Math.round(self.W * self.scale * dpr); paintCanvas.height = Math.round(self.H * self.scale * dpr);
      const g = paintCanvas.getContext('2d');
      g.setTransform(self.scale * dpr, 0, 0, self.scale * dpr, 0, 0);
      fn(g, self.W, self.H);
    },
  };
  ctx.onResize = () => self.show(self.n);
  self.show(self.n);
  return self;
}

/* Sidebar controls */
const ui = {
  group: (label, ...kids) => h('div', { class: 'fld' }, h('span', { class: 'fld-l' }, label), ...kids),
  field: (label, control, hint) => h('label', { class: 'fld' }, h('span', { class: 'fld-l' }, label), control, hint && h('span', { class: 'fld-h' }, hint)),
  seg(label, items, value, onChange) {
    const root = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    for (const [val, text] of items) root.append(h('button', {
      type: 'button', class: 'seg-b', role: 'radio', 'aria-checked': String(val === value),
      onclick: e => { root.querySelectorAll('.seg-b').forEach(b => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); onChange(val); },
    }, text));
    return root;
  },
  options(label, items, value, onChange) {
    const root = h('div', { class: 'opt', role: 'radiogroup', 'aria-label': label });
    for (const [val, title, sub] of items) root.append(h('button', {
      type: 'button', class: 'opt-b', role: 'radio', 'aria-checked': String(val === value),
      onclick: e => { root.querySelectorAll('.opt-b').forEach(b => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); onChange(val); },
    }, h('b', null, title), h('span', null, sub)));
    return root;
  },
  check(text, value, onChange) {
    const i = h('input', { type: 'checkbox', checked: !!value });
    i.addEventListener('change', () => onChange(i.checked));
    return h('label', { class: 'chk' }, i, h('span', null, text));
  },
  num(value, min, max, onChange, label) {
    const i = h('input', { type: 'number', class: 'inp', min: String(min), max: String(max), value: String(value), inputmode: 'numeric', 'aria-label': label });
    i.addEventListener('input', () => { const v = parseInt(i.value, 10); if (!Number.isNaN(v)) onChange(clamp(v, min, max)); });
    i.addEventListener('blur', () => { const v = parseInt(i.value, 10); i.value = String(Number.isNaN(v) ? min : clamp(v, min, max)); });
    return i;
  },
  text(value, onInput, attrs = {}) {
    const i = h('input', { type: 'text', class: 'inp', value, ...attrs });
    i.addEventListener('input', () => onInput(i.value, i));
    return i;
  },
  range(value, min, max, step, onInput, label) {
    const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    i.addEventListener('input', () => onInput(+i.value));
    return i;
  },
  /* A range input whose label shows the current value. */
  slider(label, value, min, max, step, fmt, onInput) {
    const out = h('span', { class: 'fld-h' }, fmt(value));
    const i = ui.range(value, min, max, step, v => { out.textContent = fmt(v); onInput(v); }, label);
    return h('label', { class: 'fld' }, h('span', { class: 'fld-l row', style: { justifyContent: 'space-between' } }, label, out), i);
  },
  color(value, onInput, label) {
    const i = h('input', { type: 'color', value, 'aria-label': label });
    i.addEventListener('input', () => onInput(i.value));
    return i;
  },
  /* 3 x 3 (or 3 x 2) position picker */
  pos(label, rows, value, onChange) {
    const names = { t: 'Top', m: 'Middle', b: 'Bottom', l: 'left', c: 'centre', r: 'right' };
    const root = h('div', { class: 'posgrid', role: 'radiogroup', 'aria-label': label });
    for (const r of rows) for (const c of 'lcr') {
      const val = r + c;
      root.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(val === value), 'aria-label': `${names[r]} ${names[c]}`, title: `${names[r]} ${names[c]}`,
        onclick: e => { root.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); onChange(val); },
      }));
    }
    return root;
  },
  pageSpan(ctx, onChange) {
    const n = ctx.docs[0].pages;
    return ui.group('Pages', h('div', { class: 'row' },
      ui.num(ctx.o.from, 1, n, v => { ctx.o.from = v; onChange(); }, 'From page'), h('span', { class: 'muted' }, 'to'),
      ui.num(ctx.o.to || n, 1, n, v => { ctx.o.to = v; onChange(); }, 'To page')));
  },
};
function spanOf(o, n) { const a = clamp(o.from || 1, 1, n), b = clamp(o.to || n, 1, n); return a <= b ? [a, b] : [b, a]; }

/* Crop a canvas to its inked area. */
function trimCanvas(c) {
  const w = c.width, hh = c.height, data = c.getContext('2d').getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(w - 1, x1 + 6); y1 = Math.min(hh - 1, y1 + 6);
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* Draw, type or upload a signature. Resolves {url, w, h} or null. */
function signatureDialog() {
  return new Promise(resolve => {
    let tab = 'draw', color = '#14181f', strokes = [], current = null, upload = null, settled = false;
    const pad = h('canvas', { class: 'pad', 'aria-label': 'Draw your signature here' });
    const typed = h('div', { class: 'typed' });
    const nameInp = ui.text('', v => { typed.textContent = v; }, { placeholder: 'Type your name', 'aria-label': 'Your name' });
    const upPrev = h('div', { class: 'sigbox' }, h('span', { class: 'muted' }, 'No image chosen'));
    const panes = {
      draw: h('div', { class: 'fld' }, pad, h('div', { class: 'row' },
        btn('Undo stroke', () => { strokes.pop(); redraw(); }, 'btn small'), btn('Clear', () => { strokes = []; redraw(); }, 'btn small'))),
      type: h('div', { class: 'fld' }, nameInp, typed),
      upload: h('div', { class: 'fld' }, upPrev, h('div', { class: 'row' }, btn('Choose image', () => pickFiles('image', false, async files => {
        try { const dd = await makeDoc(files[0]); const bmp = await createImageBitmap(new Blob([dd.bytes], { type: dd.mime }), { imageOrientation: 'from-image' });
          const s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height)); const c = makeCanvas(bmp.width * s, bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          upload = { url: c.toDataURL('image/png'), w: c.width, h: c.height }; upPrev.replaceChildren(h('img', { src: upload.url, alt: 'Chosen signature image' }));
        } catch (e) { toast(explain(e), 'err'); }
      }), 'btn small', 'upload'))),
    };
    const body = h('div');
    const swatches = h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'Ink colour' }, ...[['#14181f', 'Black'], ['#1b3fae', 'Blue'], ['#b3261e', 'Red']].map(([c, n]) =>
      h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-checked': String(c === color), 'aria-label': n, title: n, style: { background: c },
        onclick: e => { color = c; swatches.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); typed.style.color = c; redraw(); } })));
    const setTab = t => { tab = t; body.replaceChildren(panes[t]); swatches.hidden = t === 'upload'; if (t === 'draw') requestAnimationFrame(sizePad); if (t === 'type') nameInp.focus(); };
    const done = v => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    const dlg = h('dialog', { class: 'dlg wide' }, h('div', { class: 'dlg-b' },
      h('h2', null, 'Create your signature'),
      ui.seg('How to sign', [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']], tab, setTab),
      body, swatches,
      h('div', { class: 'dlg-f' }, btn('Cancel', () => done(null)), btn('Use signature', async () => {
        let c = null;
        if (tab === 'upload') { if (!upload) return toast('Choose an image first.'); return done(upload); }
        if (tab === 'draw') c = strokes.length ? trimCanvas(pad) : null;
        else if (nameInp.value.trim()) {
          try { await document.fonts.load('96px "Mrs Saint Delafield"'); } catch { /* falls back to cursive */ }
          c = trimCanvas(textImage(nameInp.value.trim(), 40, color, 400, '"Mrs Saint Delafield", "Snell Roundhand", cursive', 3).canvas);
        }
        if (!c) return toast(tab === 'draw' ? 'Draw your signature first.' : 'Type your name first.');
        done({ url: c.toDataURL('image/png'), w: c.width, h: c.height });
      }, 'btn primary'))));
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });

    function sizePad() {
      const r = pad.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (!r.width) return;
      pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr); redraw();
    }
    function redraw() {
      const g = pad.getContext('2d'), k = pad.width / (pad.getBoundingClientRect().width || pad.width);
      g.clearRect(0, 0, pad.width, pad.height);
      g.strokeStyle = g.fillStyle = color; g.lineWidth = 2.6 * k; g.lineCap = g.lineJoin = 'round';
      for (const s of strokes) {
        if (s.length === 1) { g.beginPath(); g.arc(s[0].x * k, s[0].y * k, 1.5 * k, 0, 7); g.fill(); continue; }
        g.beginPath(); g.moveTo(s[0].x * k, s[0].y * k);
        for (let i = 1; i < s.length - 1; i++) { const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2; g.quadraticCurveTo(s[i].x * k, s[i].y * k, mx * k, my * k); }
        const e = s[s.length - 1]; g.lineTo(e.x * k, e.y * k); g.stroke();
      }
    }
    const at = e => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); current = [at(e)]; strokes.push(current); redraw(); });
    pad.addEventListener('pointermove', e => { if (!current) return; current.push(at(e)); redraw(); });
    const end = () => { current = null; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);

    document.body.append(dlg); dlg.showModal(); setTab('draw');
  });
}
