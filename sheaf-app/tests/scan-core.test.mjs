import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../app/scan-core.js', import.meta.url), 'utf8'), ctx);
const S = ctx.ScanCore;
const plain = v => JSON.parse(JSON.stringify(v));   // arrays from the vm realm

/* A w×h RGBA image filled with `bg`, with the polygon `quad` (pixel corners) painted `fg`. */
function picture(w, h, quad, bg = 40, fg = 235) {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x, y) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4], z = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (!s) s = Math.sign(z); else if (Math.sign(z) && Math.sign(z) !== s) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = inside(x + 0.5, y + 0.5) ? fg : bg, j = (y * w + x) * 4;
    data[j] = data[j + 1] = data[j + 2] = v; data[j + 3] = 255;
  }
  return { data, width: w, height: h };
}

test('orderQuad sorts corners clockwise from top-left', () => {
  const q = S.orderQuad([{ x: 9, y: 9 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(q.map(p => [p.x, p.y]))), [[0, 0], [10, 1], [9, 9], [0, 10]]);
});

test('homography maps the four corners exactly', () => {
  const src = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 140 }, { x: 0, y: 140 }];
  const dst = [{ x: 12, y: 8 }, { x: 180, y: 20 }, { x: 170, y: 230 }, { x: 5, y: 210 }];
  const H = S.homography(src, dst);
  src.forEach((p, i) => { const r = S.project(H, p.x, p.y); assert.ok(Math.abs(r.x - dst[i].x) < 1e-6 && Math.abs(r.y - dst[i].y) < 1e-6); });
  assert.equal(S.homography(src, [dst[0], dst[0], dst[0], dst[0]]), null);
});

test('detectQuad finds a tilted bright page on a dark table', () => {
  const quad = [{ x: 40, y: 20 }, { x: 150, y: 35 }, { x: 140, y: 190 }, { x: 25, y: 175 }];
  const found = S.detectQuad(picture(180, 210, quad));
  assert.ok(found, 'a page should be found');
  found.forEach((p, i) => {
    assert.ok(Math.abs(p.x * 180 - quad[i].x) < 4 && Math.abs(p.y * 210 - quad[i].y) < 4, `corner ${i} is off: ${p.x * 180},${p.y * 210}`);
  });
});

test('detectQuad gives up on a blank frame and on a page filling everything', () => {
  assert.equal(S.detectQuad(picture(100, 100, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])), null);
  assert.equal(S.detectQuad(picture(100, 100, [{ x: -5, y: -5 }, { x: 105, y: -5 }, { x: 105, y: 105 }, { x: -5, y: 105 }])), null);
});

test('warp straightens the page so its contents fill the output', () => {
  const quad = [{ x: 40, y: 20 }, { x: 150, y: 35 }, { x: 140, y: 190 }, { x: 25, y: 175 }];
  const img = picture(180, 210, quad);
  const { w, h } = S.quadSize(quad);
  const out = S.warp(img, quad, w, h);
  assert.equal(out.width, Math.round(w)); assert.equal(out.height, Math.round(h));
  let bright = 0;
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i] > 200) bright++;
  assert.ok(bright / (out.width * out.height) > 0.95, 'nearly every output pixel is paper');
});

test('document filter whitens paper under a shadow and keeps ink dark', () => {
  const w = 120, h = 80, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 220 - x;                                            // lighting falls off to the right
    if (y > 35 && y < 45 && x > 10 && x < 110) v *= 0.3;        // a line of ink
    const j = (y * w + x) * 4; data[j] = data[j + 1] = data[j + 2] = v; data[j + 3] = 255;
  }
  S.applyFilter({ data, width: w, height: h }, 'doc');
  const at = (x, y) => data[(y * w + x) * 4];
  assert.equal(at(5, 10), 255); assert.equal(at(115, 10), 255);  // paper is white on both sides
  assert.ok(at(60, 40) < 60, 'ink stays dark');
});

test('parseCode understands the common QR payloads', () => {
  const url = S.parseCode('https://tooldeck.in/sheaf');
  assert.equal(url.kind, 'url'); assert.equal(url.open.url, 'https://tooldeck.in/sheaf');
  const wifi = S.parseCode('WIFI:T:WPA;S:Home\\;Net;P:pa\\:ss;H:true;;');
  assert.equal(wifi.kind, 'wifi');
  assert.deepEqual(plain(wifi.rows), [['Network', 'Home;Net'], ['Password', 'pa:ss'], ['Security', 'WPA'], ['Hidden', 'Yes']]);
  const upi = S.parseCode('upi://pay?pa=shop@okaxis&pn=Corner%20Shop&am=120.00&cu=INR');
  assert.equal(upi.kind, 'upi'); assert.deepEqual(plain(upi.rows.slice(0, 3)), [['Pay to', 'Corner Shop'], ['UPI ID', 'shop@okaxis'], ['Amount', '₹120.00']]);
  assert.equal(S.parseCode('SMSTO:+919876543210:hello there').open.url, 'sms:+919876543210?body=hello%20there');
  assert.equal(S.parseCode('mailto:a@b.co?subject=Hi').rows[1][1], 'Hi');
  assert.equal(S.parseCode('a@b.co').kind, 'email');
  assert.equal(S.parseCode('tel:+91 98765 43210').open.url, 'tel:+919876543210');
  const card = S.parseCode('BEGIN:VCARD\nVERSION:3.0\nN:Rao;Asha\nTEL;TYPE=CELL:+91 99\nEMAIL:asha@x.in\nEND:VCARD');
  assert.equal(card.kind, 'contact'); assert.equal(card.rows[0][1], 'Asha Rao');
  assert.equal(S.parseCode('8901234567890').title, 'Barcode number');
  assert.equal(S.parseCode('javascript:alert(1)').kind, 'text', 'never offered as a link');
});
