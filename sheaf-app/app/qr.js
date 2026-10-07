/* Sheaf app: qr.js
   "QR scanner": read QR codes (and barcodes where the phone supports them) from the camera
   or a photo, explain what they say, and offer the obvious next step.
   Plain script sharing Sheaf's top-level scope. */
'use strict';
const QR_HISTORY = 'sheaf.qrHistory';
const qrHistory = {
  all() { try { return JSON.parse(localStorage.getItem(QR_HISTORY)) || []; } catch { return []; } },
  add(text) {
    const list = this.all().filter(e => e.text !== text);
    list.unshift({ text, at: Date.now() });
    try { localStorage.setItem(QR_HISTORY, JSON.stringify(list.slice(0, 30))); } catch { /* storage blocked */ }
  },
  clear() { try { localStorage.removeItem(QR_HISTORY); } catch { /* storage blocked */ } },
};

/* The phone's own detector when it has one (fast, reads barcodes too); jsQR otherwise. */
let nativeDetector = null;
const detectorReady = (async () => {
  try {
    if (!('BarcodeDetector' in window)) return;
    const formats = await BarcodeDetector.getSupportedFormats();
    if (formats.includes('qr_code')) nativeDetector = new BarcodeDetector({ formats });
  } catch { nativeDetector = null; }
})();

async function readCode(source, w, hh) {
  await detectorReady;
  if (nativeDetector) {
    try { const found = await nativeDetector.detect(source); if (found.length) return found[0].rawValue; } catch { /* fall back to jsQR */ }
  }
  if (!window.jsQR) return null;
  const s = Math.min(1, 720 / Math.max(w, hh)), c = makeCanvas(w * s, hh * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, c.width, c.height);
  const r = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

function qrView(ctx) {
  const video = h('video', { class: 'qr-v', autoplay: true, muted: true, playsinline: true });
  const msg = h('p', { class: 'qr-msg', 'aria-live': 'polite' }, 'Starting the camera');
  const startBtn = btn('Start the camera', () => go(), 'btn primary', 'camera');
  startBtn.hidden = true;
  const box = h('div', { class: 'qr-cam' }, video, h('i', { class: 'qr-frame', 'aria-hidden': 'true' }), h('div', { class: 'qr-over' }, msg, startBtn));
  const torchBtn = btn('Torch', async () => {
    const on = torchBtn.getAttribute('aria-pressed') !== 'true';
    try { await Cam.torch(on); torchBtn.setAttribute('aria-pressed', String(on)); } catch { toast('The torch could not be switched.'); }
  }, 'btn ghost small', 'flash');
  torchBtn.hidden = true;
  const result = h('section', { class: 'qr-res', 'aria-live': 'polite', hidden: true });
  const hist = h('section', { class: 'qr-hist' });
  const fromPhoto = () => pickFiles('image', false, files => qrFromImage(files[0]));
  let looping = false, last = 0;

  async function go() {
    startBtn.hidden = true; msg.textContent = 'Starting the camera'; box.classList.remove('off');
    try {
      await Cam.start(video, { w: 1280, h: 720, onRestart: () => { torchBtn.setAttribute('aria-pressed', 'false'); if (result.hidden) loop(); } });
      if (S.ctx !== ctx) return Cam.stop();
      msg.textContent = 'Point the camera at a code';
      torchBtn.hidden = !Cam.canTorch();
      loop();
    } catch (e) {
      msg.textContent = e.message; startBtn.hidden = e.code === 'nocam'; box.classList.add('off');
    }
  }
  function loop() {
    if (looping) return;
    looping = true;
    const stepFn = async now => {
      if (!looping || S.ctx !== ctx || !Cam.live) { looping = false; return; }
      if (now - last > 140 && video.videoWidth) {
        last = now;
        const text = await readCode(video, video.videoWidth, video.videoHeight);
        if (text && looping) { looping = false; found(text); return; }
      }
      requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  }

  function found(text) {
    if (navigator.vibrate) navigator.vibrate(40);
    qrHistory.add(text); drawHistory(); show(text);
  }

  function show(text) {
    const info = ScanCore.parseCode(text), N = window.SheafNative;
    const copy = btn('Copy', async () => toast(await copyText(info.copy) ? 'Copied' : 'Copying is blocked here. Press and hold the text instead.'), 'btn small', 'copy');
    const actions = [
      info.open && btn(info.open.label, () => N && N.native ? N.openUrl(info.open.url) : window.open(info.open.url, '_blank', 'noopener'), 'btn primary small', 'link'),
      copy,
      (N && N.native || navigator.share) && btn('Share', () => (N && N.native ? N.shareText(text) : navigator.share({ text }).catch(() => {})), 'btn small', 'share'),
      btn('Scan again', () => { result.hidden = true; box.hidden = false; if (Cam.live) loop(); else go(); }, 'btn ghost small', 'qr'),
    ];
    result.replaceChildren(...[
      h('h2', null, info.title),
      h('dl', null, info.rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      info.kind === 'wifi' && h('p', { class: 'muted' }, 'To join, copy the password, then pick the network in Wi-Fi settings.'),
      h('div', { class: 'row' }, actions)].filter(Boolean));
    result.hidden = false;
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function qrFromImage(file) {
    if (!file || kindOf(file) !== 'image') return toast('Pick a photo or screenshot of a code.');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return toast(`${file.name} could not be read.`, 'err'); }
    looping = false;
    const text = await readCode(bmp, bmp.width, bmp.height);
    bmp.close && bmp.close();
    if (text) found(text);
    else { toast('No code found in that picture. Crop closer to the code and try again.'); if (Cam.live && result.hidden) loop(); }
  }
  ctx.onFiles = files => qrFromImage(files[0]);

  function drawHistory() {
    const list = qrHistory.all();
    hist.replaceChildren();
    if (!list.length) return;
    hist.append(h('div', { class: 'qr-hh' }, h('h2', null, 'Recent scans'),
      btn('Clear', () => { qrHistory.clear(); drawHistory(); }, 'btn ghost small')),
    h('ul', null, list.map(e => {
      const info = ScanCore.parseCode(e.text);
      return h('li', null, h('button', { type: 'button', onclick: () => { looping = false; show(e.text); } },
        h('b', null, info.title), h('span', null, e.text.length > 90 ? e.text.slice(0, 90) + '…' : e.text),
        h('time', { datetime: new Date(e.at).toISOString() }, new Date(e.at).toLocaleString())));
    })));
  }

  drawHistory();
  requestAnimationFrame(go);
  return h('div', { class: 'qr' }, box, h('div', { class: 'row qr-acts' }, btn('Scan from a photo', fromPhoto, 'btn small', 'img2pdf'), torchBtn), result, hist);
}

TOOLS.unshift({
  id: 'qr', name: 'QR scanner', cat: 'scan', icon: 'qr', accept: 'image', multiple: false,
  desc: 'Read QR codes from the camera or a photo: links, UPI, Wi-Fi, contacts and more.',
  keys: 'qr code barcode reader scanner upi wifi link camera',
  sheet: qrView,
  onFiles(files) { if (S.ctx && S.ctx.onFiles) S.ctx.onFiles(files); },
  mount() {}, async run() { return null; },
});
