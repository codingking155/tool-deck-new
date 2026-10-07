/* Draw the launcher icons, splash screens and Play Store graphics from the Sheaf logo.
   Run once after changing the artwork: node scripts/make-icons.mjs
   Uses Playwright from the ToolDeck root (set CHROMIUM=/path/to/chrome to pick a browser). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const res = new URL('../android/app/src/main/res/', import.meta.url).pathname;
const store = new URL('../store/', import.meta.url).pathname;
const MAT = '#1d5746';
const LOGO = `
  <path d="M9.5 6.5V3h6.5l4.5 4.5V17h-4" fill="none" stroke="#a9c9bc" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M3.5 7h7L15 11.5V21H3.5z" fill="#fcfdfc" stroke="#fcfdfc" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M10.5 7v4.5H15z" fill="#ffd23f" stroke="#ffd23f" stroke-width="1.5" stroke-linejoin="round"/>`;
const GRID = `background-color:${MAT};background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px)`;
/* logo: side of the logo box as a fraction of the canvas */
const page = (w, h, { bg = MAT, radius = 0, logo = 0.6, grid = 0, text = '' } = {}) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${h * 0.08}px;border-radius:${radius};overflow:hidden;${bg ? (grid ? `${GRID};background-size:${grid}px ${grid}px` : `background:${bg}`) : ''}">
<svg viewBox="2 2 20 20" width="${Math.min(w, h) * logo}" height="${Math.min(w, h) * logo}">${LOGO}</svg>${text}</div></body></html>`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage();
async function shot(file, w, h, opt) {
  await tab.setViewportSize({ width: w, height: h });
  await tab.setContent(page(w, h, opt));
  await tab.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  // adaptive icon foreground: 108dp canvas, logo inside the 66dp safe circle
  await shot(`${res}mipmap-${d}/ic_launcher_foreground.png`, 108 * k, 108 * k, { bg: '', logo: 0.5 });
  await shot(`${res}mipmap-${d}/ic_launcher.png`, 48 * k, 48 * k, { radius: '18%', logo: 0.68 });
  await shot(`${res}mipmap-${d}/ic_launcher_round.png`, 48 * k, 48 * k, { radius: '50%', logo: 0.62 });
}
const splash = { 'drawable': [480, 320], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280] };
for (const [dir, [w, h]] of Object.entries(splash)) await shot(`${res}${dir}/splash.png`, w, h, { logo: 0.22 });

mkdirSync(store, { recursive: true });
await shot(`${store}icon-512.png`, 512, 512, { logo: 0.66, grid: 32 });
await shot(`${store}feature-graphic.png`, 1024, 500, { logo: 0.5, grid: 40, text: `<div style="font:700 92px/1 Georgia,serif;color:#eef5f0;letter-spacing:-2px">Sheaf<div style="font:500 30px/1.3 system-ui,sans-serif;letter-spacing:0;color:#a9c9bc;margin-top:18px">Scan, merge &amp; edit PDFs.<br>Read QR codes. All offline.</div></div>` });
await browser.close();
console.log('icons written');
