/* Sheaf: app.js
   Home page, tool page, result screen, routing, drag and drop, start-up.
   Plain scripts loaded in order by index.html; they share one top-level scope. */
'use strict';
/* =====================================================================
   7. App shell: home, tool page, results, routing
===================================================================== */
const S = { view: 'home', cat: 'all', q: '', tray: [], ctx: null };
const app = document.getElementById('app');
let homeView = null;

const brand = () => h('button', { type: 'button', class: 'brand', onclick: goHome, 'aria-label': 'Sheaf, all tools' }, icon('logo', 26), 'Sheaf');

function syncHash() {
  const want = S.view === 'tool' ? '#/' + S.ctx.tool.id : '#/';
  try { if (location.hash !== want && !(want === '#/' && !location.hash)) location.hash = want; } catch { /* sandboxed frame: routing still works in memory */ }
}
function route() {
  const id = (location.hash || '').replace(/^#\/?/, ''), tool = TOOLS.find(t => t.id === id);
  if (tool) { if (!S.ctx || S.ctx.tool !== tool) openTool(id); }
  else if (S.view !== 'home') goHome();
}
function closeCtx() {
  if (!S.ctx) return;
  S.ctx.docs.forEach(closeDoc); thumbQueue.length = 0; S.ctx = null;
}
function goHome() { closeCtx(); S.view = 'home'; syncHash(); renderHome(); window.scrollTo(0, 0); }

/* ---------- home ---------- */
function trayCounts() {
  let pdf = 0, image = 0;
  for (const f of S.tray) { if (kindOf(f) === 'pdf') pdf++; else image++; }
  return { pdf, image };
}
function fits(tool) {
  if (!S.tray.length) return true;
  const c = trayCounts();
  return tool.accept === 'image' ? c.image > 0 : c.pdf > 0 && (tool.multiple || c.pdf === 1);
}
function renderHome() {
  document.body.classList.remove('tool');
  const search = h('input', { type: 'search', placeholder: 'Search tools', 'aria-label': 'Search tools', value: S.q, autocomplete: 'off' });
  search.addEventListener('input', () => { S.q = search.value; drawCards(); });
  const drop = h('div', { class: 'drop' }), chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter tools' });
  const note = h('p', { class: 'traynote muted', hidden: true }), cards = h('div', { class: 'cards' });
  const choose = () => pickFiles('any', true, takeFiles);

  function drawDrop() {
    if (!S.tray.length) {
      drop.replaceChildren(icon('upload', 38), h('h2', null, 'Drop PDFs or images here'),
        h('p', null, 'Then pick what to do with them. Or start from any tool below.'), btn('Choose files', choose, 'btn primary', 'upload'));
      return;
    }
    const names = S.tray.slice(0, 4).map(f => h('li', null, f.name));
    if (S.tray.length > 4) names.push(h('li', null, `and ${S.tray.length - 4} more`));
    drop.replaceChildren(icon('check', 38), h('h2', null, `${plural(S.tray.length, 'file')} ready`), h('ul', { class: 'tray' }, names),
      h('p', null, 'Pick a tool below to continue.'),
      h('div', { class: 'row' }, btn('Add more', choose, 'btn ghost small', 'plus'), btn('Clear', () => { S.tray = []; drawDrop(); drawCards(); }, 'btn ghost small')));
  }
  function drawChips() {
    chips.replaceChildren(...[['all', 'All tools'], ...CATS].map(([id, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(S.cat === id), style: id === 'all' ? null : { '--dot': `var(--c-${id})` },
      onclick: () => { S.cat = id; drawChips(); drawCards(); },
    }, id !== 'all' && h('i'), label)));
  }
  function drawCards() {
    const terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = TOOLS.filter(t => (S.cat === 'all' || t.cat === S.cat) && fits(t)
      && terms.every(q => `${t.name} ${t.desc} ${t.keys || ''}`.toLowerCase().includes(q)));
    const c = trayCounts();
    note.hidden = !S.tray.length;
    note.textContent = S.tray.length ? `Showing the tools that work with your ${[c.pdf && plural(c.pdf, 'PDF'), c.image && plural(c.image, 'image')].filter(Boolean).join(' and ')}.` : '';
    cards.replaceChildren(...list.map(t => {
      const el = h('button', { type: 'button', class: 'card', onclick: () => {
        const files = S.tray.filter(f => kindOf(f) === t.accept); S.tray = []; openTool(t.id, files);
      } }, icon(t.icon, 30), h('h3', null, t.name), h('p', null, t.desc));
      el.style.setProperty('--fold', `var(--c-${t.cat})`);
      return el;
    }));
    if (!list.length) cards.append(h('p', { class: 'empty' }, S.q ? `No tool matches “${S.q}”. Try a different word, or clear the search.` : 'No tool in this group takes these files. Choose “All tools”.'));
  }
  app.replaceChildren(
    h('div', { class: 'mat' },
      h('header', { class: 'top' }, brand(), h('label', { class: 'search' }, icon('search', 16), search)),
      h('section', { class: 'hero' },
        h('div', null, h('h1', null, 'Every PDF job, done on your own device.'),
          h('p', null, 'Merge, split, compress, convert, sign and lock PDFs. Your files are processed in this browser tab and are never uploaded.')),
        h('div', { class: 'dropwrap' }, drop))),
    h('main', { class: 'tools' }, h('h2', { class: 'sr' }, 'Tools'), chips, note, cards),
    h('footer', { class: 'foot' },
      h('p', null, 'Word, Excel, PowerPoint and OCR conversions need a server, so they are not part of this browser-only build.'),
      h('p', null, 'Sheaf runs entirely in your browser. Nothing you open here leaves your device.')));
  homeView = { drawDrop, drawCards, search };
  drawDrop(); drawChips(); drawCards();
}

/* ---------- tool page ---------- */
function openTool(id, files) {
  const tool = TOOLS.find(t => t.id === id);
  if (!tool) return goHome();
  closeCtx();
  S.view = 'tool';
  const ctx = S.ctx = { tool, docs: [], pages: [], o: tool.init ? tool.init() : {}, stage: 'empty', ready: false, busy: false };
  ctx.add = addFiles;
  ctx.reset = () => { ctx.docs.forEach(closeDoc); ctx.docs = []; ctx.pages = []; ctx.o = tool.init ? tool.init() : {}; ctx.stage = 'empty'; renderTool(); };
  syncHash(); renderTool(); window.scrollTo(0, 0);
  if (files && files.length) addFiles(files);
}

async function addFiles(files) {
  const ctx = S.ctx;
  if (!ctx || ctx.busy || ctx.stage === 'loading') return;
  const tool = ctx.tool;
  let list = [...files].filter(f => kindOf(f) === tool.accept);
  if (!list.length) return toast(tool.accept === 'pdf' ? `${tool.name} takes PDF files.` : `${tool.name} takes images: JPG, PNG or WebP.`);
  if (!tool.multiple) list = list.slice(0, 1);
  ctx.stage = 'loading'; renderTool();
  const added = [];
  for (const f of list) {
    try { added.push(await makeDoc(f)); }
    catch (e) { if (e.code !== 'cancelled') toast(`${f.name} could not be opened. ${explain(e)}`, 'err'); }
  }
  if (S.ctx !== ctx) { added.forEach(closeDoc); return; }
  if (added.length && !tool.multiple) { ctx.docs.forEach(closeDoc); ctx.docs = []; ctx.pages = []; ctx.o = tool.init ? tool.init() : {}; }
  for (const d of added) {
    ctx.docs.push(d);
    if (tool.pages) for (let i = 0; i < d.pages; i++) ctx.pages.push(newPick(d, i));
  }
  ctx.stage = ctx.docs.length ? 'work' : 'empty';
  renderTool();
}

function showBusy(title) {
  const bar = h('i', { style: { width: '6%' } }), label = h('p', null, '\u00a0');
  const el = h('div', { class: 'busy', role: 'alertdialog', 'aria-label': title }, h('div', { class: 'busy-b' }, h('h2', null, title), h('div', { class: 'bar' }, bar), label));
  document.body.append(el);
  return { set(f, text) { bar.style.width = Math.round(clamp(f, 0.06, 1) * 100) + '%'; if (text) label.textContent = text; }, close() { el.remove(); } };
}
async function runTool() {
  const ctx = S.ctx;
  if (!ctx || !ctx.ready || ctx.busy) return;
  ctx.busy = true;
  const busy = showBusy(ctx.tool.busy || 'Working');
  await tick(40);
  try {
    const res = await ctx.tool.run(ctx, async (f, label) => { busy.set(f, label); await tick(); });
    if (S.ctx !== ctx) return;
    busy.set(1);
    ctx.result = res; ctx.zip = null; ctx.stage = 'done'; renderTool(); window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    toast(`${ctx.tool.name} did not finish. ${explain(e)}`, 'err');
  } finally { ctx.busy = false; busy.close(); }
}

function dropSheet(tool) {
  const label = tool.accept === 'image' ? 'Choose images' : tool.multiple ? 'Choose PDFs' : 'Choose a PDF';
  return h('div', { class: 'dropwrap' }, h('div', { class: 'drop' }, icon(tool.icon, 40), h('h2', null, tool.name), h('p', null, tool.desc),
    btn(label, () => pickFiles(tool.accept, tool.multiple, addFiles), 'btn primary', 'upload'), h('p', null, 'or drop files anywhere on this page')));
}

function resultView(ctx) {
  const res = ctx.result, outs = res.outputs, tool = ctx.tool, many = outs.length > 1;
  const total = outs.reduce((s, o) => s + o.blob.size, 0);
  const ext = (outs[0].name.match(/\.([^.]+)$/) || [, 'file'])[1].toUpperCase();
  const dl = btn(many ? `Download ${outs.length} files as ZIP` : `Download ${ext}`, async () => {
    dl.disabled = true;
    try {
      if (!many) await saveFile(outs[0].name, outs[0].blob);
      else { ctx.zip = ctx.zip || await zipBlob(outs); await saveFile(`${baseName(ctx.docs[0] ? ctx.docs[0].name : 'sheaf')}-${tool.id}.zip`, ctx.zip); }
    } catch (e) { toast(`The download did not start. ${explain(e)}`, 'err'); }
    dl.disabled = false;
  }, 'btn primary', 'download');
  const sheet = h('div', { class: 'drop' }, icon('check', 40), h('h2', null, res.title),
    h('p', null, [res.note, many ? `${outs.length} files, ${fmtBytes(total)}` : `${outs[0].name}, ${fmtBytes(total)}`].filter(Boolean).join('. ')), dl,
    many && h('ul', { class: 'outs' }, outs.map(o => h('li', null, h('span', { title: o.name }, o.name), h('span', { class: 'muted' }, o.note || fmtBytes(o.blob.size)),
      tb('download', `Download ${o.name}`, () => saveFile(o.name, o.blob))))));
  const allPdf = outs.every(o => /\.pdf$/i.test(o.name));
  const nextIds = !allPdf ? [] : (many ? ['merge', 'compress'] : ['compress', 'protect', 'pagenum', 'watermark', 'sign', 'organize', 'split']).filter(id => id !== tool.id).slice(0, 4);
  const carry = () => outs.map(o => new File([o.blob], o.name, { type: 'application/pdf' }));
  return h('div', { class: 'bench solo' }, h('div', { class: 'work mat' }, h('div', { class: 'result' },
    h('div', { class: 'dropwrap' }, sheet),
    nextIds.length > 0 && h('div', { class: 'next' }, h('p', null, many ? 'Keep working on these files' : 'Keep working on this file'),
      h('div', { class: 'row' }, nextIds.map(id => { const t = TOOLS.find(x => x.id === id); return btn(t.name, () => openTool(id, carry()), 'btn small', t.icon); }))),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      btn('Back to editing', () => { ctx.stage = 'work'; renderTool(); }, 'btn small', 'left'), btn('Start over', () => openTool(tool.id), 'btn small')))));
}

function renderTool() {
  const ctx = S.ctx, tool = ctx.tool;
  document.body.classList.add('tool');
  ctx.onResize = null;
  const top = h('header', { class: 'top bar' }, brand(), h('nav', { class: 'crumb', 'aria-label': 'Breadcrumb' },
    h('button', { type: 'button', onclick: goHome }, icon('left', 15), 'All tools'), h('span', { 'aria-hidden': 'true' }, '/'), h('b', { role: 'heading', 'aria-level': '1' }, tool.name)));
  if (ctx.stage === 'work') {
    const work = h('div', { class: 'work mat' }), body = h('div', { class: 'side-body' }, h('h2', null, tool.name));
    const hint = h('p', { class: 'hint', 'aria-live': 'polite' }), cta = h('button', { type: 'button', class: 'btn primary big', disabled: true, onclick: runTool }, tool.cta);
    ctx.setReady = (ok, msg = '') => { ctx.ready = !!ok; cta.disabled = !ok; hint.textContent = msg; };
    app.replaceChildren(top, h('div', { class: 'bench' }, work, h('aside', { class: 'side', 'aria-label': `${tool.name} options` }, body, h('div', { class: 'side-foot' }, hint, cta))));
    tool.mount(ctx, work, body);   // mounted after attaching so previews can measure themselves
    return;
  }
  ctx.setReady = () => {};
  const inner = ctx.stage === 'done' ? null
    : ctx.stage === 'loading' ? h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spin' }), 'Opening your files')
    : dropSheet(tool);
  app.replaceChildren(top, inner ? h('div', { class: 'bench solo' }, h('div', { class: 'work mat' }, inner)) : resultView(ctx));
}

/* ---------- files arriving from anywhere: drop, paste, picker ---------- */
function takeFiles(files) {
  const good = [...files].filter(kindOf);
  if (!good.length) return toast('Only PDFs and images can be opened here.');
  if (S.view === 'home') { S.tray = S.tray.concat(good); homeView.drawDrop(); homeView.drawCards(); return; }
  const ctx = S.ctx;
  if (!ctx || ctx.busy) return;
  if (ctx.stage === 'done') return openTool(ctx.tool.id, good);
  addFiles(good);
}
const hasFiles = e => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('is-drag'); });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('is-drag'); });
window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('is-drag'); takeFiles(e.dataTransfer.files); });
window.addEventListener('paste', e => { const f = e.clipboardData && e.clipboardData.files; if (f && f.length) { e.preventDefault(); takeFiles(f); } });
window.addEventListener('keydown', e => {
  if (e.key === '/' && S.view === 'home' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); homeView.search.focus(); }
});
let lastW = window.innerWidth, resizeTimer = 0;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastW) return;   // ignore mobile URL-bar height changes
  lastW = window.innerWidth; clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (S.ctx && S.ctx.onResize) S.ctx.onResize(); }, 180);
});
window.addEventListener('hashchange', route);

if (TOOLS.some(t => '#/' + t.id === location.hash)) route(); else renderHome();
