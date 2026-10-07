/* Sheaf app: scan-core.js
   Pure maths for the document scanner and the QR reader: finding the page in a photo,
   straightening it, cleaning it up, and making sense of what a QR code says.
   No DOM. Images are ImageData-shaped: { data: Uint8ClampedArray RGBA, width, height }.
   Loaded as a plain script (defines the global ScanCore) and by the unit tests through vm. */
'use strict';
var ScanCore = (function () {
  /* ---------- geometry ---------- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* Put four corners in reading order: top-left, top-right, bottom-right, bottom-left. */
  function orderQuad(pts) {
    const by = (f, max) => pts.reduce((best, p) => (max ? f(p) > f(best) : f(p) < f(best)) ? p : best);
    const tl = by(p => p.x + p.y, false), br = by(p => p.x + p.y, true);
    const rest = pts.filter(p => p !== tl && p !== br);
    if (rest.length !== 2) return [tl, by(p => p.x - p.y, true), br, by(p => p.x - p.y, false)];
    const [a, b] = rest;
    return a.x - a.y > b.x - b.y ? [tl, a, br, b] : [tl, b, br, a];
  }

  /* Output size for a straightened page: the longer of each pair of opposite edges. */
  function quadSize(q) {
    return { w: Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h: Math.max(dist(q[0], q[3]), dist(q[1], q[2])) };
  }

  function quadArea(q) {
    let s = 0;
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  }

  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-9) return false;
      if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
    }
    return true;
  }

  /* Solve A·x = b (n×n) by Gaussian elimination with partial pivoting. null when singular. */
  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /* The 3×3 projective transform (row-major, h33 = 1) that sends src[i] to dst[i]. */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const hv = solve(A, b);
    return hv ? [...hv, 1] : null;
  }
  function project(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  /* Cut the quad out of src and lay it flat as a W×H image (bilinear sampling). */
  function warp(src, quad, W, H) {
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    const M = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad);
    if (!M) throw new Error('Those corners do not make a page. Drag them apart and try again.');
    const sd = src.data, sw = src.width, sh = src.height, out = new Uint8ClampedArray(W * H * 4);
    let o = 0;
    for (let y = 0; y < H; y++) {
      const cy = y + 0.5;
      // numerator and denominator are linear in x along a row
      let nx = M[0] * 0.5 + M[1] * cy + M[2], ny = M[3] * 0.5 + M[4] * cy + M[5], nw = M[6] * 0.5 + M[7] * cy + M[8];
      for (let x = 0; x < W; x++, nx += M[0], ny += M[3], nw += M[6]) {
        let sx = nx / nw - 0.5, sy = ny / nw - 0.5;
        if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
        if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
        const x0 = sx | 0, y0 = sy | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx, bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          out[o + c] = top + (bot - top) * fy;
        }
        out[o + 3] = 255; o += 4;
      }
    }
    return { data: out, width: W, height: H };
  }

  /* ---------- finding the page ---------- */
  function luma(img) {
    const d = img.data, n = img.width * img.height, g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }
  function otsu(g) {
    const hist = new Float64Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sumB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  /* Paper is usually the largest bright patch in a document photo. Take the largest bright
     connected region and its four extreme corners. Expects a small image (about 200 px);
     returns corners as fractions of width and height, or null when no page stands out. */
  function detectQuad(img) {
    const w = img.width, h = img.height, n = w * h, g0 = luma(img), g = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // 3×3 box blur to quiet text and texture
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += g0[yy * w + xx]; k++; } }
      g[y * w + x] = s / k;
    }
    const thr = otsu(g), label = new Int32Array(n), stack = new Int32Array(n);
    let best = 0, bestSize = 0, next = 0;
    for (let s = 0; s < n; s++) {
      if (label[s] || g[s] <= thr) continue;
      const id = ++next; let top = 0, size = 0;
      stack[top++] = s; label[s] = id;
      while (top) {
        const p = stack[--top]; size++;
        const x = p % w;
        if (x > 0 && !label[p - 1] && g[p - 1] > thr) { label[p - 1] = id; stack[top++] = p - 1; }
        if (x < w - 1 && !label[p + 1] && g[p + 1] > thr) { label[p + 1] = id; stack[top++] = p + 1; }
        if (p >= w && !label[p - w] && g[p - w] > thr) { label[p - w] = id; stack[top++] = p - w; }
        if (p < n - w && !label[p + w] && g[p + w] > thr) { label[p + w] = id; stack[top++] = p + w; }
      }
      if (size > bestSize) { bestSize = size; best = id; }
    }
    if (!best || bestSize < n * 0.12 || bestSize > n * 0.985) return null;
    let tl = null, tr = null, br = null, bl = null;
    for (let p = 0; p < n; p++) {
      if (label[p] !== best) continue;
      const x = p % w + 0.5, y = (p / w | 0) + 0.5, s = x + y, d = x - y;
      if (!tl || s < tl.s) tl = { x, y, s }; if (!br || s > br.s) br = { x, y, s };
      if (!tr || d > tr.d) tr = { x, y, d }; if (!bl || d < bl.d) bl = { x, y, d };
    }
    const q = [tl, tr, br, bl].map(p => ({ x: p.x / w, y: p.y / h }));
    const px = q.map(p => ({ x: p.x * w, y: p.y * h }));
    // the corners must enclose most of the region, or the "page" is a blob, not a sheet
    if (!isConvex(px) || quadArea(px) < bestSize * 0.75 || quadArea(px) > bestSize * 1.35) return null;
    return q;
  }

  /* ---------- clean-up filters (in place) ---------- */
  function stretchLevels(img, gray) {
    const d = img.data, g = luma(img), hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let lo = 0, hi = 255, acc = 0;
    const cut = g.length * 0.01;
    for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cut) break; }
    acc = 0;
    for (; hi > lo; hi--) { acc += hist[hi]; if (acc > cut) break; }
    const span = Math.max(32, hi - lo), k = 255 / span;
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      if (gray) { const v = (g[i] - lo) * k; d[j] = d[j + 1] = d[j + 2] = v; }
      else { d[j] = (d[j] - lo) * k; d[j + 1] = (d[j + 1] - lo) * k; d[j + 2] = (d[j + 2] - lo) * k; }
    }
  }

  /* Divide out uneven lighting (shadows, a dim corner) against the local mean, then push
     the paper to white and keep the ink dark with soft edges. */
  function documentLook(img) {
    const w = img.width, h = img.height, d = img.data, g = luma(img);
    const S = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
    }
    const r = Math.max(7, Math.round(Math.min(w, h) / 24));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0)), ratio = g[y * w + x] / (mean + 1);
        let v;
        if (ratio >= 0.9) v = 255;
        else { const t = Math.max(0, (ratio - 0.45) / 0.45); v = 255 * t * t; }
        const j = (y * w + x) * 4; d[j] = d[j + 1] = d[j + 2] = v;
      }
    }
  }

  const FILTERS = [['color', 'Colour'], ['gray', 'Greyscale'], ['doc', 'Document'], ['none', 'Original']];
  function applyFilter(img, name) {
    if (name === 'color') stretchLevels(img, false);
    else if (name === 'gray') stretchLevels(img, true);
    else if (name === 'doc') documentLook(img);
    return img;
  }

  /* ---------- what a scanned code says ---------- */
  /* Split "K:v;K:v;;" payloads (WIFI:, MATMSG:) honouring backslash escapes. */
  function fieldsOf(body) {
    const out = {}; let key = '', val = '', inVal = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\\' && i + 1 < body.length) { (inVal ? (val += body[++i]) : (key += body[++i])); continue; }
      if (!inVal && c === ':') { inVal = true; continue; }
      if (c === ';') { if (key) out[key.toUpperCase()] = val; key = ''; val = ''; inVal = false; continue; }
      if (inVal) val += c; else key += c;
    }
    if (key) out[key.toUpperCase()] = val;
    return out;
  }
  function safeDecode(s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } }
  function query(s) {
    const out = {}, i = s.indexOf('?');
    if (i < 0) return out;
    for (const part of s.slice(i + 1).split('&')) {
      if (!part) continue;
      const k = part.indexOf('='), key = safeDecode(k < 0 ? part : part.slice(0, k)), val = k < 0 ? '' : safeDecode(part.slice(k + 1));
      out[key.toLowerCase()] = val;
    }
    return out;
  }
  const rows = pairs => pairs.filter(p => p[1]);

  /* -> { kind, title, rows: [[label, value]], open?: { label, url }, copy } */
  function parseCode(raw) {
    const text = String(raw || '').trim();
    const lower = text.toLowerCase();
    if (/^https?:\/\/\S+$/i.test(text)) {
      let host = '';
      try { host = new URL(text).host; } catch { /* not a full URL */ }
      return { kind: 'url', title: 'Website link', rows: rows([['Site', host], ['Link', text]]), open: { label: 'Open link', url: text }, copy: text };
    }
    if (lower.startsWith('upi://')) {
      const q = query(text);
      return { kind: 'upi', title: 'UPI payment', rows: rows([['Pay to', q.pn], ['UPI ID', q.pa], ['Amount', q.am && `₹${q.am}`], ['Note', q.tn]]),
        open: { label: 'Pay with a UPI app', url: text }, copy: q.pa || text };
    }
    if (lower.startsWith('wifi:')) {
      const f = fieldsOf(text.slice(5));
      const sec = (f.T || '').toUpperCase();
      return { kind: 'wifi', title: 'Wi-Fi network', rows: rows([['Network', f.S], ['Password', f.P], ['Security', sec === 'NOPASS' || !sec ? 'Open' : sec], ['Hidden', /^true$/i.test(f.H || '') && 'Yes']]),
        copy: f.P || f.S || text };
    }
    if (lower.startsWith('mailto:')) {
      const addr = safeDecode(text.slice(7).split('?')[0]), q = query(text);
      return { kind: 'email', title: 'Email', rows: rows([['To', addr], ['Subject', q.subject], ['Message', q.body]]), open: { label: 'Write email', url: text }, copy: addr };
    }
    if (lower.startsWith('matmsg:')) {
      const f = fieldsOf(text.slice(7));
      const url = `mailto:${f.TO || ''}?subject=${encodeURIComponent(f.SUB || '')}&body=${encodeURIComponent(f.BODY || '')}`;
      return { kind: 'email', title: 'Email', rows: rows([['To', f.TO], ['Subject', f.SUB], ['Message', f.BODY]]), open: { label: 'Write email', url }, copy: f.TO || text };
    }
    if (lower.startsWith('tel:')) {
      const num = text.slice(4);
      return { kind: 'phone', title: 'Phone number', rows: [['Number', num]], open: { label: 'Call', url: 'tel:' + num.replace(/[^\d+*#]/g, '') }, copy: num };
    }
    if (lower.startsWith('smsto:') || lower.startsWith('sms:')) {
      const body = text.slice(text.indexOf(':') + 1), cut = body.search(/[:?]/);
      const num = cut < 0 ? body : body.slice(0, cut);
      const msg = cut < 0 ? '' : body[cut] === '?' ? (query(body).body || '') : body.slice(cut + 1);
      return { kind: 'sms', title: 'Text message', rows: rows([['To', num], ['Message', msg]]),
        open: { label: 'Send message', url: `sms:${num}${msg ? `?body=${encodeURIComponent(msg)}` : ''}` }, copy: msg || num };
    }
    if (lower.startsWith('geo:')) {
      const [lat, lng] = text.slice(4).split(/[,;?]/);
      return { kind: 'geo', title: 'Location', rows: rows([['Latitude', lat], ['Longitude', lng]]), open: { label: 'Open in maps', url: text }, copy: `${lat},${lng}` };
    }
    if (/^begin:vcard/i.test(text)) {
      const get = k => { const m = new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(text); return m ? m[1].trim() : ''; };
      const name = get('FN') || get('N').split(';').filter(Boolean).reverse().join(' ');
      return { kind: 'contact', title: 'Contact', rows: rows([['Name', name], ['Phone', get('TEL')], ['Email', get('EMAIL')], ['Company', get('ORG').replace(/;/g, ' ')], ['Website', get('URL')]]),
        copy: [name, get('TEL'), get('EMAIL')].filter(Boolean).join('\n') };
    }
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(text)) return parseCode('mailto:' + text);
    if (/^www\.\S+\.\S+$/i.test(text)) return parseCode('https://' + text);
    return { kind: 'text', title: /^\d{8,14}$/.test(text) ? 'Barcode number' : 'Text', rows: [['Text', text]], copy: text };
  }

  return { orderQuad, quadSize, quadArea, isConvex, homography, project, warp, detectQuad, applyFilter, FILTERS, parseCode, otsu };
})();
if (typeof module !== 'undefined') module.exports = ScanCore;
