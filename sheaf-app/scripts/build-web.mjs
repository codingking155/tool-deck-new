/* Assemble www/ for Capacitor: Sheaf from ../public/sheaf (the same code tooldeck.in serves),
   its libraries and fonts from node_modules, and the app layer from app/.
   Sheaf's files are copied as they are, apart from a few strings checked below that talk about
   "this browser tab" and "downloads"; the build fails if one of them is no longer found. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const sheaf = `${root}../public/sheaf`, out = `${root}www`, nm = `${root}node_modules`;

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/vendor/fonts`, { recursive: true });
mkdirSync(`${out}/app`, { recursive: true });
for (const dir of ['css', 'js']) cpSync(`${sheaf}/${dir}`, `${out}/${dir}`, { recursive: true });

/* Same libraries and fonts as the sheafVendor plugin in the site's vite.config.js, plus jsQR. */
const vendor = {
  'pdf-lib.min.js': '@cantoo/pdf-lib/dist/pdf-lib.min.js',
  'pdf.min.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'jszip.min.js': 'jszip/dist/jszip.min.js',
  'Sortable.min.js': 'sortablejs/Sortable.min.js',
  'jsQR.js': 'jsqr/dist/jsQR.js',
};
for (const [to, from] of Object.entries(vendor)) copyFileSync(`${nm}/${from}`, `${out}/vendor/${to}`);
const fonts = [['Besley', 'besley', [500, 700, 800]], ['Instrument Sans', 'instrument-sans', [400, 500, 600, 700]], ['Mrs Saint Delafield', 'mrs-saint-delafield', [400]]];
let css = '';
for (const [family, pkg, weights] of fonts) for (const w of weights) {
  const f = `${pkg}-latin-${w}-normal.woff2`;
  copyFileSync(`${nm}/@fontsource/${pkg}/files/${f}`, `${out}/vendor/fonts/${f}`);
  css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${f}) format('woff2')}\n`;
}
writeFileSync(`${out}/vendor/fonts.css`, css);

/* App layer: plain scripts copied, the Capacitor bridge bundled into one classic script. */
const scripts = ['scan-core.js', 'camera.js', 'scan.js', 'qr.js', 'qrmake.js', 'mobile.js'];
for (const f of [...scripts, 'mobile.css']) copyFileSync(`${root}app/${f}`, `${out}/app/${f}`);
await build({ entryPoints: [`${root}app/native.src.js`], bundle: true, format: 'iife', target: 'chrome90', minify: true, outfile: `${out}/app/native.js`, logLevel: 'error' });
/* the qrcode library as a global (window.QRCode) for qrmake.js */
await build({ stdin: { contents: "import QRCode from 'qrcode'; window.QRCode = QRCode;", resolveDir: root }, bundle: true, format: 'iife', target: 'chrome90', minify: true, outfile: `${out}/vendor/qrcode.js`, logLevel: 'error' });

function patch(file, pairs) {
  let s = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`build-web: "${from}" is no longer in ${file.replace(root, '')}. Update scripts/build-web.mjs.`);
    s = s.split(from).join(to);
  }
  writeFileSync(file, s);
}
patch(`${out}/js/app.js`, [
  ['Drop PDFs or images here', 'Open PDFs or images'],
  ['Your files are processed in this browser tab and are never uploaded.', 'Everything runs on this phone, even offline. Your files are never uploaded.'],
  ['Word, Excel, PowerPoint and OCR conversions need a server, so they are not part of this browser-only build.', 'Word, Excel, PowerPoint and OCR conversions need a server, so Sheaf leaves them out.'],
  ['Sheaf runs entirely in your browser. Nothing you open here leaves your device.', 'Sheaf works offline. Nothing you open here leaves your phone.'],
  ["h('p', null, 'or drop files anywhere on this page')", "h('p', null, 'Your files stay on this phone.')"],
  ['`Download ${outs.length} files as ZIP` : `Download ${ext}`', '`Save ${outs.length} files as ZIP` : `Save ${ext}`'],
  ['The download did not start.', 'The file was not saved.'],
]);
patch(`${out}/js/core.js`, [['Check your connection and reload the page.', 'Close Sheaf and open it again.']]);

const appTags = ['<script src="vendor/jsQR.js" defer></script>', '<script src="vendor/qrcode.js" defer></script>', ...scripts.map(f => `<script src="app/${f}" defer></script>`)].join('\n');
writeFileSync(`${out}/index.html`, readFileSync(`${sheaf}/index.html`, 'utf8'));
patch(`${out}/index.html`, [
  ['<title>Sheaf: PDF tools that run in your browser</title>', '<title>Sheaf</title>\n<meta name="color-scheme" content="light dark">\n<link rel="icon" href="data:,">'],
  ['<script src="js/theme.js"></script>', '<script src="app/native.js"></script>\n<script src="js/theme.js"></script>'],
  ['<link rel="stylesheet" href="css/styles.css">', '<link rel="stylesheet" href="css/styles.css">\n<link rel="stylesheet" href="app/mobile.css">'],
  ['<script src="js/app.js" defer></script>', `<script src="js/app.js" defer></script>\n${appTags}`],
]);
if (!existsSync(`${out}/vendor/pdf.worker.min.mjs`)) throw new Error('build-web: pdf.js worker missing');
console.log('www/ ready');
