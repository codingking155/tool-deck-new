/* Sheaf app: scan.js
   "Scan to PDF": photograph pages, straighten them by their corners, clean them up, and hand
   them to the Image to PDF workspace. Plain script sharing Sheaf's top-level scope. */
'use strict';
const SCAN_MAX = 2400;          // long side of a kept page, in pixels (about 200 dpi on A4)
const FILTER_KEY = 'sheaf.scanFilter', AUTO_KEY = 'sheaf.autoCapture';
const STEADY_FRAMES = 5;        // outline checks (about 1.3 s) the page must hold still before auto-capture
let scanCount = 0, scanQueue = Promise.resolve();

const savedFilter = () => { try { return localStorage.getItem(FILTER_KEY) || 'color'; } catch { return 'color'; } };
const rememberFilter = f => { try { localStorage.setItem(FILTER_KEY, f); } catch { /* storage blocked */ } };
const pixels = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function paint(img) { const c = makeCanvas(img.width, img.height); c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return c; }
const fullQuad = (w, hh) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }];

/* Corners of the page in canvas pixels, from a quick look at a small copy. */
function findPage(canvas) {
  const s = Math.min(1, 200 / Math.max(canvas.width, canvas.height));
  const small = makeCanvas(canvas.width * s, canvas.height * s);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const q = ScanCore.detectQuad(pixels(small));
  if (!q) return null;
  // pull each corner 1% toward the middle so no sliver of table shows along the edges
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
  return q.map(p => ({ x: (p.x + (cx - p.x) * 0.01) * canvas.width, y: (p.y + (cy - p.y) * 0.01) * canvas.height }));
}

function rotateCanvas(c) {
  const out = makeCanvas(c.height, c.width), g = out.getContext('2d');
  g.translate(out.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0);
  return out;
}

/* Straighten and clean one page. `max` caps the long side of the result. */
function flatten(src, quad, filter, max) {
  const { w, h: hh } = ScanCore.quadSize(quad), s = Math.min(1, max / Math.max(w, hh));
  // sample from a source no larger than needed, so the warp stays quick and sharp
  const k = Math.min(1, (Math.max(w, hh) * s * 1.25) / Math.max(w, hh));
  let from = src, q = quad;
  if (k < 0.99) { from = makeCanvas(src.width * k, src.height * k); from.getContext('2d').drawImage(src, 0, 0, from.width, from.height); q = quad.map(p => ({ x: p.x * k, y: p.y * k })); }
  const flat = ScanCore.warp(pixels(from), q, w * s, hh * s);
  return paint(ScanCore.applyFilter(flat, filter));
}

/* ---------- the editor: corners first, then the look ---------- */
function editPage(source, opt = {}) {
  return new Promise(resolve => {
    let src = source, quad = opt.quad || findPage(src) || fullQuad(src.width, src.height), filter = savedFilter(), settled = false;
    const L = layer('ed', () => finish(null));
    function finish(v) { if (settled) return; settled = true; L.close(); resolve(v); }

    const title = h('h2', null, 'Fit the corners');
    const stage = h('div', { class: 'ed-stage' }), bot = h('div', { class: 'ed-bot' });
    const rot = tb('cw', 'Rotate right', () => {
      const H0 = src.height;
      src = rotateCanvas(src); quad = ScanCore.orderQuad(quad.map(p => ({ x: H0 - p.y, y: p.x }))); step === 1 ? drawCorners() : drawLook();
    }, 'ed-rot');
    L.el.append(h('div', { class: 'ed-top' }, btn(opt.cancelLabel || 'Retake', () => finish(null), 'btn ghost small'), title, rot), stage, bot);
    let step = 1;

    function fit() {
      const r = stage.getBoundingClientRect(), pad = 22;
      const s = Math.min((r.width - pad * 2) / src.width, (r.height - pad * 2) / src.height);
      return { s, x: (r.width - src.width * s) / 2, y: (r.height - src.height * s) / 2 };
    }

    function drawCorners() {
      step = 1; title.textContent = 'Fit the corners';
      const f = fit(), view = makeCanvas(src.width * f.s, src.height * f.s);
      view.getContext('2d').drawImage(src, 0, 0, view.width, view.height);
      Object.assign(view.style, { left: f.x + 'px', top: f.y + 'px', width: view.width + 'px', height: view.height + 'px' });
      view.className = 'ed-img';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ed-svg'); const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); svg.append(poly);
      const handles = quad.map((p, i) => {
        const hd = h('button', { type: 'button', class: 'ed-h', 'aria-label': ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i] + ' corner' });
        hd.addEventListener('pointerdown', e => {
          e.preventDefault(); hd.setPointerCapture(e.pointerId); hd.classList.add('on');
          const move = ev => {
            const r = stage.getBoundingClientRect();
            quad[i] = { x: clamp((ev.clientX - r.left - f.x) / f.s, 0, src.width), y: clamp((ev.clientY - r.top - f.y) / f.s, 0, src.height) };
            place();
          };
          const up = () => { hd.classList.remove('on'); hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); };
          hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
        });
        // arrow keys nudge a focused corner
        hd.addEventListener('keydown', e => {
          const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!d) return; e.preventDefault();
          const by = (e.shiftKey ? 20 : 4) / f.s;
          quad[i] = { x: clamp(quad[i].x + d[0] * by, 0, src.width), y: clamp(quad[i].y + d[1] * by, 0, src.height) }; place();
        });
        return hd;
      });
      function place() {
        poly.setAttribute('points', quad.map(p => `${f.x + p.x * f.s},${f.y + p.y * f.s}`).join(' '));
        handles.forEach((hd, i) => { hd.style.left = (f.x + quad[i].x * f.s) + 'px'; hd.style.top = (f.y + quad[i].y * f.s) + 'px'; });
        const ok = ScanCore.isConvex(quad) && ScanCore.quadArea(quad) > src.width * src.height * 0.02;
        next.disabled = !ok; svg.classList.toggle('bad', !ok);
      }
      const next = btn('Next', () => drawLook(), 'btn primary', 'right');
      stage.replaceChildren(view, svg, ...handles);
      bot.replaceChildren(
        h('div', { class: 'row' },
          btn('Whole photo', () => { quad = fullQuad(src.width, src.height); place(); }, 'btn ghost small'),
          btn('Find page', () => { const q = findPage(src); if (q) { quad = q; place(); } else toast('No page edge stood out. Drag the corners instead.'); }, 'btn ghost small')),
        next);
      place();
    }

    function drawLook() {
      step = 2; title.textContent = 'Choose a look';
      const r = stage.getBoundingClientRect(), max = Math.max(320, Math.min(1100, Math.max(r.width, r.height) * (window.devicePixelRatio || 1)));
      let preview;
      try { preview = flatten(src, quad, 'none', max); } catch (e) { toast(explain(e), 'err'); return drawCorners(); }
      const shown = h('img', { class: 'ed-look', alt: 'Preview of the cleaned-up page' });
      const show = () => {
        const c = makeCanvas(preview.width, preview.height);
        c.getContext('2d').drawImage(preview, 0, 0);
        const img = ScanCore.applyFilter(pixels(c), filter);
        shown.src = paint(img).toDataURL('image/jpeg', 0.85);
      };
      const chips = h('div', { class: 'chips ed-chips', role: 'group', 'aria-label': 'Look' });
      const drawChips = () => chips.replaceChildren(...ScanCore.FILTERS.map(([id, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(filter === id), onclick: () => { filter = id; rememberFilter(id); drawChips(); show(); },
      }, label)));
      const keep = btn(opt.keepLabel || 'Keep page', async () => {
        keep.disabled = true; keep.textContent = 'Saving';
        await tick(30);
        try {
          const page = flatten(src, quad, filter, SCAN_MAX);
          const blob = await canvasBlob(page, 'image/jpeg', 0.86);
          const file = new File([blob], `Scan page ${++scanCount}.jpg`, { type: 'image/jpeg' });
          file._scanned = true;
          finish(file);
        } catch (e) { toast(`That page could not be saved. ${explain(e)}`, 'err'); keep.disabled = false; keep.textContent = 'Keep page'; }
      }, 'btn primary', 'check');
      stage.replaceChildren(shown);
      bot.replaceChildren(chips, h('div', { class: 'row' }, btn('Corners', drawCorners, 'btn ghost small', 'left'), keep));
      drawChips(); show();
    }

    requestAnimationFrame(drawCorners);
  });
}

/* ---------- pictures from the gallery or a share ---------- */
async function canvasFromFile(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name} is not an image Sheaf can read. Use JPG, PNG or WebP.`); }
  const s = Math.min(1, 3200 / Math.max(bmp.width, bmp.height)), c = makeCanvas(bmp.width * s, bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return c;
}
async function importPhotos(files, add) {
  const list = [...files].filter(f => kindOf(f) === 'image');
  for (let i = 0; i < list.length; i++) {
    let c;
    try { c = await canvasFromFile(list[i]); } catch (e) { toast(explain(e), 'err'); continue; }
    const kept = await editPage(c, { cancelLabel: list.length > 1 ? 'Skip' : 'Cancel', keepLabel: i < list.length - 1 ? 'Keep, next photo' : 'Keep page' });
    if (kept) add(kept);
  }
}

/* ---------- the camera ---------- */
function scanSession(add) {
  let kept = 0, timer = 0, busy = false;
  /* auto-capture: shoot once the page has held still; then wait for the page to move or leave
     (a new sheet, or the phone lifted) before shooting again, so one page is not taken twice */
  let auto = (() => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } })();
  let prev = null, steady = 0, armed = true, lastShot = null;
  const video = h('video', { class: 'cam-v', autoplay: true, muted: true, playsinline: true });
  const guide = h('canvas', { class: 'cam-guide', 'aria-hidden': 'true' });
  const status = h('p', { class: 'cam-msg', 'aria-live': 'polite' }, 'Starting the camera');
  const count = h('span', { class: 'cam-count' }, '0');
  const L = layer('cam', () => { clearInterval(timer); Cam.stop(); });
  const torchBtn = tb('flash', 'Torch', async () => {
    const on = torchBtn.getAttribute('aria-pressed') !== 'true';
    try { await Cam.torch(on); torchBtn.setAttribute('aria-pressed', String(on)); } catch { toast('The torch could not be switched.'); }
  }, 'cam-tb');
  torchBtn.hidden = true;
  const autoBtn = h('button', { type: 'button', class: 'cam-auto', 'aria-pressed': String(auto), onclick: () => {
    auto = !auto; autoBtn.setAttribute('aria-pressed', String(auto)); steady = 0;
    try { localStorage.setItem(AUTO_KEY, auto ? '1' : '0'); } catch { /* storage blocked */ }
    status.textContent = auto ? 'Auto: hold the phone still over a page.' : 'Auto is off. Tap the button to take each page.';
  } }, 'Auto');
  const shutter = h('button', { type: 'button', class: 'shutter', 'aria-label': 'Take photo', onclick: shoot });
  const done = h('button', { type: 'button', class: 'cam-done', onclick: () => L.close() }, count, 'Done');
  L.el.append(video, guide,
    h('div', { class: 'cam-top' }, tb('x', 'Close the camera', () => L.close(), 'cam-tb'), status, autoBtn, torchBtn),
    h('div', { class: 'cam-bot' },
      h('button', { type: 'button', class: 'cam-side', onclick: () => pickFiles('image', true, files => importPhotos(files, keep)) }, icon('img2pdf', 22), 'Photos'),
      shutter, done));

  function keep(file) { kept++; count.textContent = String(kept); status.textContent = `${plural(kept, 'page')} so far`; add(file); }

  function outline() {
    if (busy || !Cam.live || !video.videoWidth) return;
    const box = L.el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (guide.width !== Math.round(box.width * dpr)) { guide.width = Math.round(box.width * dpr); guide.height = Math.round(box.height * dpr); }
    const g = guide.getContext('2d'); g.clearRect(0, 0, guide.width, guide.height);
    const q = ScanCore.detectQuad(pixels(Cam.frame(video, 160)));
    const moved = (a, b) => a && b ? Math.max(...a.map((p, i) => Math.abs(p.x - b[i].x) + Math.abs(p.y - b[i].y))) : 1;
    if (!armed && (!q || moved(q, lastShot) > 0.08)) armed = true;
    steady = q && moved(q, prev) < 0.012 ? steady + 1 : 0;
    prev = q;
    if (!q) return;
    const still = auto && armed && steady >= 2;
    if (auto && armed) status.textContent = still ? 'Hold still…' : 'Auto: hold the phone still over a page.';
    if (still && steady >= STEADY_FRAMES) { steady = 0; armed = false; lastShot = q; shoot(); return; }
    const r = containRect(box.width, box.height, video.videoWidth, video.videoHeight);
    g.save(); g.scale(dpr, dpr); g.beginPath();
    q.forEach((p, i) => { const x = r.x + p.x * video.videoWidth * r.s, y = r.y + p.y * video.videoHeight * r.s; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    const c = still ? '76,196,151' : '255,210,63';
    g.closePath(); g.lineWidth = still ? 4 : 3; g.strokeStyle = `rgb(${c})`; g.fillStyle = `rgba(${c},.16)`; g.fill(); g.stroke(); g.restore();
  }

  async function shoot(ev) {
    if (busy || !Cam.live) return;
    if (ev) { armed = false; lastShot = prev; }   // a tap counts as this page's shot too
    busy = true; shutter.disabled = true;
    const shot = Cam.frame(video);
    L.el.classList.add('flash'); setTimeout(() => L.el.classList.remove('flash'), 160);
    const file = await editPage(shot);
    if (file) keep(file);
    busy = false; shutter.disabled = false; steady = 0;
    if (auto) status.textContent = file ? 'Turn to the next page, or tap Done.' : 'Auto: hold the phone still over a page.';
    guide.getContext('2d').clearRect(0, 0, guide.width, guide.height);
  }

  Cam.start(video, { w: 2560, h: 1920, onRestart: () => { torchBtn.setAttribute('aria-pressed', 'false'); } })
    .then(() => {
      status.textContent = auto ? 'Auto: hold the phone still over a page.' : 'Point at a page. The yellow outline shows what Sheaf sees.';
      torchBtn.hidden = !Cam.canTorch();
      timer = setInterval(outline, 260);
    })
    .catch(e => {
      status.textContent = e.message; shutter.disabled = true; autoBtn.hidden = true;
      L.el.classList.add('nocam');
    });
}

/* ---------- the tool ---------- */
(() => {
  const base = TOOLS.find(t => t.id === 'img2pdf');
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`; };
  /* Pages join the workspace one at a time, in the order they were kept. */
  const addPage = file => { scanQueue = scanQueue.then(() => sheafAddFiles([file])).catch(() => {}); };

  TOOLS.unshift(Object.assign({}, base, {
    id: 'scan', name: 'Scan to PDF', cat: 'scan', icon: 'scan', cta: 'Save PDF', busy: 'Building your PDF',
    desc: 'Photograph paper pages, straighten and clean them, and save one tidy PDF.',
    keys: 'camera scanner scan document receipt photo cam paper notes',
    init: () => ({ size: 'a4', orient: 'auto', margin: 'none' }),
    onFiles: files => importPhotos(files, addPage),
    startCamera: () => scanSession(addPage),
    sheet: () => h('div', { class: 'dropwrap' }, h('div', { class: 'drop' }, icon('scan', 40), h('h2', null, 'Scan to PDF'),
      h('p', null, 'Photograph each page. Sheaf finds the edges, straightens the page and cleans it up.'),
      btn('Open the camera', () => scanSession(addPage), 'btn primary', 'camera'),
      btn('Use photos instead', () => pickFiles('image', true, files => importPhotos(files, addPage)), 'btn ghost small', 'img2pdf'),
      h('p', { class: 'tip' }, 'Tip: lay the page on a darker surface so its edges stand out.'))),
    mount(ctx, work, side) {
      const ready = ctx.setReady;
      ctx.setReady = (ok, msg) => ready(ok, ctx.docs.length ? `${plural(ctx.docs.length, 'page')} scanned. Drag them into order.` : msg);
      base.mount(ctx, work, side);
      side.querySelector('h2').after(btn('Scan more pages', () => scanSession(addPage), 'btn small', 'camera'));
    },
    async run(ctx, progress) {
      const res = await base.run(ctx, progress);
      res.title = `Scanned ${plural(ctx.docs.length, 'page')}`;
      res.outputs[0].name = `Scan ${stamp()}.pdf`;
      return res;
    },
  }));
})();
