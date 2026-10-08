/* Sheaf app: qrmake.js
   "QR code maker": a link or text, a UPI payment ("Scan & pay" for a shop counter) or Wi-Fi
   login, as an image to share or a printable A4 poster. Uses the qrcode library (vendor/qrcode.js).
   Plain script sharing Sheaf's top-level scope. */
'use strict';
const QM_KEY = 'sheaf.qrMake';
const QM_KINDS = [['text', 'Link or text'], ['upi', 'UPI payment'], ['wifi', 'Wi-Fi']];
const QM_HEAD = { text: 'Scan me', upi: 'Scan & pay', wifi: 'Free Wi-Fi' };
const QM_DPI = 150 / 72;            // poster canvas pixels per PDF point (A4 at 150 dpi)

function qmLoad() {
  const base = { kind: 'text', text: '', pa: '', pn: '', am: '', tn: '', s: '', p: '', t: 'WPA', h: false, head: '' };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(QM_KEY)) || {}); } catch { return base; }
}
/* Remembered so a shop owner opens straight to their UPI code. The Wi-Fi password is not kept. */
function qmSave(st) {
  const { p, ...keep } = st;
  try { localStorage.setItem(QM_KEY, JSON.stringify(keep)); } catch { /* storage blocked */ }
}

function qrCanvas(text, px) {
  const c = document.createElement('canvas');
  return new Promise((resolve, reject) => QRCode.toCanvas(c, text, { errorCorrectionLevel: 'M', margin: 2, width: px, color: { dark: '#000000', light: '#ffffff' } },
    e => e ? reject(new Error(/too big|amount of data/i.test(e.message) ? 'That is too much text for one QR code. Shorten it.' : e.message)) : resolve(c)));
}

/* The words printed under the code. */
function qmLabel(st) {
  if (st.kind === 'upi') return { name: st.pn.trim(), sub: `UPI ID: ${st.pa.trim()}`, extra: st.am ? `Amount: ₹${(+st.am).toFixed(2)}` : 'Pay with any UPI app' };
  if (st.kind === 'wifi') return { name: st.s.trim(), sub: st.t === 'nopass' ? 'No password needed' : 'Point your camera at the code to join', extra: '' };
  const t = st.text.trim();
  return { name: '', sub: t.length > 60 ? t.slice(0, 60) + '…' : t, extra: '' };
}

function fitText(g, text, font, size, maxW) {
  let s = size;
  do { g.font = `${font.replace('$', s)}`; s -= 2; } while (g.measureText(text).width > maxW && s > 12);
}

/* A share-sized card: the code with its label underneath. */
async function qmCard(text, st) {
  const W = 900, qr = await qrCanvas(text, 760), L = qmLabel(st);
  const lines = [L.name && ['700 $px Besley, Georgia, serif', 52, '#13201b'], L.sub && ['500 $px "Instrument Sans", system-ui, sans-serif', 32, '#44524c'], L.extra && ['600 $px "Instrument Sans", system-ui, sans-serif', 32, '#1d5746']]
    .map((f, i) => f && [[L.name, L.sub, L.extra][i], ...f]).filter(Boolean);
  const c = makeCanvas(W, 70 + 760 + 30 + lines.length * 56 + 40), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(qr, (W - 760) / 2, 50);
  g.textAlign = 'center'; g.textBaseline = 'top';
  let y = 50 + 760 + 24;
  for (const [t, font, size, color] of lines) { fitText(g, t, font, size, W - 80); g.fillStyle = color; g.fillText(t, W / 2, y); y += 56; }
  return c;
}

/* A4 poster for a counter or a wall, drawn on a canvas so any script (Hindi, Kannada...) prints. */
async function qmPoster(text, st) {
  const W = Math.round(595.28 * QM_DPI), H = Math.round(841.89 * QM_DPI), c = makeCanvas(W, H), g = c.getContext('2d'), L = qmLabel(st);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d5746'; g.fillRect(0, 0, W, 300);
  g.fillStyle = '#ffd23f'; g.fillRect(0, 300, W, 14);
  const head = st.head.trim() || QM_HEAD[st.kind];
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
  fitText(g, head, '700 $px Besley, Georgia, serif', 120, W - 140); g.fillText(head, W / 2, 158);
  const side = 860, qr = await qrCanvas(text, side);
  g.drawImage(qr, (W - side) / 2, 380);
  g.strokeStyle = '#d4ddd7'; g.lineWidth = 3; g.strokeRect((W - side) / 2 - 1.5, 380 - 1.5, side + 3, side + 3);
  g.textBaseline = 'top'; let y = 380 + side + 50;
  if (L.name) { g.fillStyle = '#13201b'; fitText(g, L.name, '700 $px Besley, Georgia, serif', 78, W - 160); g.fillText(L.name, W / 2, y); y += 100; }
  if (L.sub) { g.fillStyle = '#44524c'; fitText(g, L.sub, '500 $px "Instrument Sans", system-ui, sans-serif', 44, W - 160); g.fillText(L.sub, W / 2, y); y += 66; }
  if (L.extra) { g.fillStyle = '#1d5746'; fitText(g, L.extra, '600 $px "Instrument Sans", system-ui, sans-serif', 44, W - 160); g.fillText(L.extra, W / 2, y); }
  g.fillStyle = '#8a9a92'; g.font = '500 24px "Instrument Sans", system-ui, sans-serif'; g.fillText('Made with Sheaf', W / 2, H - 70);
  const pdf = await PDFDocument.create(), page = pdf.addPage([595.28, 841.89]);
  page.drawImage(await pdf.embedPng(dataUrlBytes(c.toDataURL('image/png'))), { x: 0, y: 0, width: 595.28, height: 841.89 });
  pdf.setTitle(`${head}${L.name ? ' - ' + L.name : ''}`); pdf.setCreator('Sheaf');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

function qrMakeView(ctx) {
  const st = qmLoad();
  const form = h('div', { class: 'qm-form' }), preview = h('div', { class: 'qm-prev' }), err = h('p', { class: 'qm-err', 'aria-live': 'polite' });
  const btnRow = h('div', { class: 'row qm-acts' });
  let timer = 0, current = null, gen = 0;
  const fileStem = () => (st.kind === 'upi' ? `UPI ${st.pn || st.pa}` : st.kind === 'wifi' ? `Wi-Fi ${st.s}` : 'QR code').trim().replace(/[\\/:*?"<>|]+/g, '_');

  const field = (label, key, attrs = {}, hint) => {
    const i = ui.text(st[key] || '', v => { st[key] = v; changed(); }, { 'data-k': key, autocomplete: 'off', ...attrs });
    return ui.field(label, i, hint);
  };
  function drawForm() {
    const kinds = ui.seg('Kind of code', QM_KINDS, st.kind, v => { st.kind = v; drawForm(); changed(); });
    const parts = [kinds];
    if (st.kind === 'text') {
      const ta = h('textarea', { class: 'inp', rows: 3, 'data-k': 'text', placeholder: 'https://… or any text', 'aria-label': 'Link or text' }, st.text);
      ta.addEventListener('input', () => { st.text = ta.value; changed(); });
      parts.push(ui.group('Link or text', ta));
    } else if (st.kind === 'upi') {
      parts.push(field('UPI ID', 'pa', { placeholder: 'yourshop@okaxis', inputmode: 'email', autocapitalize: 'off', spellcheck: false }),
        field('Name shown to the payer', 'pn', { placeholder: 'Corner Shop' }),
        field('Amount in ₹ (optional)', 'am', { inputmode: 'decimal', placeholder: 'Leave empty to let them type it' }),
        field('Note (optional)', 'tn', { placeholder: 'Order 42' }));
    } else {
      parts.push(field('Network name', 's', { autocapitalize: 'off', spellcheck: false }),
        ui.group('Security', ui.seg('Security', [['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', 'No password']], st.t, v => { st.t = v; drawForm(); changed(); })));
      if (st.t !== 'nopass') parts.push(field('Password', 'p', { type: 'text', autocapitalize: 'off', spellcheck: false }, 'Not saved on this phone.'));
      parts.push(ui.check('Hidden network', st.h, v => { st.h = v; changed(); }));
    }
    parts.push(field('Poster heading', 'head', { placeholder: QM_HEAD[st.kind] }, 'Printed at the top of the A4 poster.'));
    form.replaceChildren(...parts);
  }

  function changed() { clearTimeout(timer); timer = setTimeout(render, 140); }
  async function render() {
    const my = ++gen;
    form.querySelectorAll('.inp.bad').forEach(i => i.classList.remove('bad'));
    const r = ScanCore.buildCode(st.kind, st);
    current = null;
    btnRow.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (r.error) {
      err.textContent = r.error;
      preview.replaceChildren(h('div', { class: 'qm-empty' }, icon('qrmake', 44), h('p', null, 'Your code appears here.')));
      const typed = st[r.field];
      if (typed && String(typed).trim()) { const bad = form.querySelector(`[data-k="${r.field}"]`); if (bad) bad.classList.add('bad'); } else err.textContent = '';
      return;
    }
    err.textContent = '';
    qmSave(st);
    try {
      const card = await qmCard(r.text, st);
      if (my !== gen) return;
      card.className = 'qm-card'; card.setAttribute('role', 'img'); card.setAttribute('aria-label', `QR code: ${qmLabel(st).name || qmLabel(st).sub}`);
      preview.replaceChildren(card);
      current = { text: r.text, card };
      btnRow.querySelectorAll('button').forEach(b => { b.disabled = false; });
    } catch (e) { err.textContent = explain(e); }
  }

  const pngOut = async () => ({ name: `${fileStem()}.png`, blob: await canvasBlob(current.card, 'image/png') });
  const run = fn => async e => {
    if (!current) return;
    const b = e.currentTarget; b.disabled = true;
    try { await fn(); } catch (x) { toast(explain(x), 'err'); }
    b.disabled = false;
  };
  btnRow.append(...[
    btn('Save image', run(async () => { const o = await pngOut(); await saveFile(o.name, o.blob); }), 'btn primary small', 'download'),
    canShareFiles() && btn('Share', run(async () => shareOutputs([await pngOut()])), 'btn small', 'share'),
    btn('A4 poster PDF', run(async () => saveFile(`${fileStem()} poster.pdf`, await qmPoster(current.text, st))), 'btn small', 'pdf2jpg')].filter(Boolean));

  drawForm(); render();
  return h('div', { class: 'qr qm' },
    h('section', { class: 'qm-out' }, preview, err, btnRow),
    h('section', { class: 'qm-in' }, form));
}

TOOLS.unshift({
  id: 'qrmake', name: 'QR code maker', cat: 'scan', icon: 'qrmake', accept: 'none', multiple: false,
  desc: 'Make a QR code for a link, a UPI payment or your Wi-Fi. Save it, share it or print an A4 poster.',
  keys: 'qr code generator create make upi payment shop wifi poster print',
  sheet: qrMakeView,
  mount() {}, async run() { return null; },
});
