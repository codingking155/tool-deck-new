/* Sheaf app: mobile.js
   Loaded last, after Sheaf's own app.js. Adds the Scan group (Scan to PDF, QR scanner) and
   adapts the web app to a phone: saving into Documents/Sheaf, the share sheet, and quick
   actions on the home page. Sheaf's scripts are untouched; their top-level functions are
   wrapped here, which works because plain scripts share one global scope. */
'use strict';
const NATIVE = !!(window.SheafNative && SheafNative.native);

Object.assign(ICONS, {
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8h8v8H8z" opacity=".55"/><path d="M3 12h18"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2.500v2.500H14zM18 18h2v2h-2zM18 14h2M14 19h2"/>',
  camera: '<path d="M4 8a1 1 0 0 1 1-1h2.500L9 5h6l1.500 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><circle cx="12" cy="12.500" r="3.500"/>',
  flash: '<path d="M13 3 6 13.500h5L10 21l7-10.500h-5z"/>',
  share: '<circle cx="17.500" cy="5.500" r="2.500"/><circle cx="6.500" cy="12" r="2.500"/><circle cx="17.500" cy="18.500" r="2.500"/><path d="m8.700 10.800 6.600-4M8.700 13.200l6.600 4"/>',
  copy: '<path d="M9 9h10v11H9z"/><path d="M5 15V4h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700L11.500 6.800"/><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1.500-1.500"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  qrmake: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M17 14v6M14 17h6"/>',
});
CATS.unshift(['scan', 'Scan & QR']);
/* each tool file put itself first; set the Scan & QR order */
for (const id of ['qrmake', 'qr', 'scan']) { const i = TOOLS.findIndex(t => t.id === id); if (i > 0) TOOLS.unshift(...TOOLS.splice(i, 1)); }

/* ---------- saving and sharing ---------- */
/* A toast with one button, kept up longer so there is time to tap it. */
function toastAction(msg, label, fn, kind = 'ok') {
  const el = h('div', { class: 'toast act ' + kind, role: 'status' }, h('span', null, msg),
    h('button', { type: 'button', onclick: () => { el.remove(); fn(); } }, label));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 8000);
}
const MIME = { pdf: 'application/pdf', zip: 'application/zip', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const mimeOf = name => MIME[(name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase()] || 'application/octet-stream';

const webSave = saveFile;
saveFile = async function (name, blob) {
  if (!NATIVE) return webSave(name, blob);
  try {
    const saved = await SheafNative.save(name, blob);
    toastAction(`Saved to ${saved.shown}`, 'Open', () => SheafNative.open(saved.uri, mimeOf(name)).catch(e => toast(explain(e), 'err')));
  } catch (e) { toast(`The file was not saved. ${explain(e)}`, 'err'); }
};
async function shareOutputs(outs) {
  try {
    if (NATIVE) return await SheafNative.share(outs.map(o => ({ name: o.name, blob: o.blob })), outs.length > 1 ? 'Share files' : 'Share ' + outs[0].name);
    const files = outs.map(o => new File([o.blob], o.name, { type: o.blob.type }));
    if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files });
  } catch (e) { if (e.name !== 'AbortError') toast(`Sharing did not work. ${explain(e)}`, 'err'); }
}
const canShareFiles = () => NATIVE || !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));

const sheafResultView = resultView;
resultView = function (ctx) {
  const el = sheafResultView(ctx);
  const main = el.querySelector('.drop .btn.primary');
  if (main && canShareFiles()) main.after(btn(ctx.result.outputs.length > 1 ? 'Share all' : 'Share', () => shareOutputs(ctx.result.outputs), 'btn', 'share'));
  return el;
};

/* ---------- tools with their own start screen and file handling ---------- */
const sheafAddFiles = addFiles;
addFiles = function (files) {
  const tool = S.ctx && S.ctx.tool;
  if (tool && tool.onFiles && ![...files].every(f => f._scanned)) return tool.onFiles(files);
  return sheafAddFiles(files);
};
const sheafDropSheet = dropSheet;
dropSheet = function (tool) { return tool.sheet ? tool.sheet(S.ctx) : sheafDropSheet(tool); };
const sheafCloseCtx = closeCtx;
closeCtx = function () { Cam.stop(); document.querySelectorAll('.layer').forEach(l => l.remove()); document.body.classList.remove('layered'); sheafCloseCtx(); };
const sheafFits = fits;
fits = function (tool) {
  if (tool.id === 'qr') return !S.tray.length || trayCounts().image === 1;
  if (tool.accept === 'none') return !S.tray.length;
  return sheafFits(tool);
};

/* ---------- home: the two camera jobs up front ---------- */
const sheafRenderHome = renderHome;
renderHome = function () {
  sheafRenderHome();
  const hero = document.querySelector('.hero > div');
  if (!hero) return;
  const scan = TOOLS.find(t => t.id === 'scan');
  hero.append(h('div', { class: 'quick' },
    h('button', { type: 'button', class: 'quick-b', onclick: () => { openTool('scan'); scan.startCamera(); } }, icon('scan', 28), h('b', null, 'Scan a document'), h('span', null, 'Camera to PDF')),
    h('button', { type: 'button', class: 'quick-b', onclick: () => openTool('qr') }, icon('qr', 28), h('b', null, 'Scan a QR code'), h('span', null, 'Links, UPI, Wi-Fi'))));
};

/* ---------- files shared to Sheaf, or opened with it ---------- */
if (NATIVE) SheafNative.onIncoming((files, failed) => {
  if (failed) toast(`Sheaf could not read ${failed}.`, 'err');
  const good = files.filter(kindOf);
  if (!good.length) { if (files.length) toast('Only PDFs and images can be opened in Sheaf.'); return; }
  document.querySelectorAll('.layer').forEach(l => l.remove()); document.body.classList.remove('layered'); Cam.stop();
  const ctx = S.ctx;
  // stay in the open tool when it takes these files; otherwise put them in the home tray
  if (S.view === 'tool' && ctx && !ctx.busy && ctx.stage !== 'done' && good.every(f => kindOf(f) === ctx.tool.accept)) return takeFiles(good);
  if (S.view !== 'home') goHome();
  S.tray = [];
  takeFiles(good);
  toast(good.length === 1 ? `${good[0].name} is ready. Pick a tool.` : `${good.length} files are ready. Pick a tool.`, 'ok');
});

document.documentElement.classList.toggle('native', NATIVE);
/* Sheaf's app.js already drew the page before these tools existed; draw it again. */
if (TOOLS.some(t => "#/" + t.id === location.hash)) { closeCtx(); route(); } else renderHome();
