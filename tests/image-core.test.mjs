import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtBytes, resizeDims, fitMax, cropRect, outName, noopReason, compressMime, targetBytes, searchQuality, fitToTarget } from "../src/lib/imageCore.mjs";
import { makeZip } from "../src/lib/zip.js";

test("fmtBytes", () => {
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(2048), "2.0 KB");
  assert.equal(fmtBytes(5 * 1048576), "5.00 MB");
});

test("resizeDims", () => {
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", width: 500, keep: true }), { w: 500, h: 250 });
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", height: 100, keep: true }), { w: 200, h: 100 });
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", width: 300, height: 300, keep: true }), { w: 300, h: 150 });
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", width: 300, height: 300, keep: false }), { w: 300, h: 300 });
  assert.deepEqual(resizeDims(1000, 500, { mode: "pct", pct: 50 }), { w: 500, h: 250 });
});

test("resizeDims: one empty box scales proportionally even with keep off (width-only presets)", () => {
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", width: 300, height: "", keep: false }), { w: 300, h: 150 });
  assert.deepEqual(resizeDims(1000, 500, { mode: "px", width: "", height: 250, keep: false }), { w: 500, h: 250 });
});

test("fitMax never upscales", () => {
  assert.deepEqual(fitMax(4000, 2000, 1000), { w: 1000, h: 500 });
  assert.deepEqual(fitMax(800, 600, 1000), { w: 800, h: 600 });
  assert.deepEqual(fitMax(800, 600, ""), { w: 800, h: 600 });
});

test("cropRect", () => {
  assert.deepEqual(cropRect(1000, 500, { aspect: "1:1", zoom: 1, panX: 50, panY: 50 }), { x: 250, y: 0, w: 500, h: 500 });
  assert.deepEqual(cropRect(1000, 500, { aspect: "free", zoom: 2, panX: 0, panY: 100 }), { x: 0, y: 250, w: 500, h: 250 });
});

test("outName", () => {
  assert.equal(outName("photo.PNG", "-min", "image/webp"), "photo-min.webp");
});

test("ImageTool ZIP (zip.js makeZip) writes a valid DOS date and unique names", () => {
  const z = makeZip([{ name: "a.txt", data: new TextEncoder().encode("hi") }, { name: "a.txt", data: new Uint8Array([1]) }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 2);
  const date = dv.getUint16(12, true), month = (date >> 5) & 15, day = date & 31;
  assert.ok(month >= 1 && month <= 12 && day >= 1 && day <= 31 && (date >> 9) + 1980 >= 2020);
  assert.match(new TextDecoder().decode(z), /a \(2\)\.txt/);
});

test("compressMime: 'Same as original' keeps JPG/PNG/WebP, sends GIF/BMP/SVG/AVIF to WebP", () => {
  for (const t of ["image/jpeg", "image/png", "image/webp"]) assert.equal(compressMime("auto", t), t);
  for (const t of ["image/gif", "image/bmp", "image/svg+xml", "image/avif", ""]) assert.equal(compressMime("auto", t), "image/webp");
  assert.equal(compressMime("image/jpeg", "image/gif"), "image/jpeg");
});

test("noopReason: explains no-op applies", () => {
  assert.match(noopReason("compress", { by: "target", kb: "" }), /target size/);
  assert.equal(noopReason("compress", { by: "target", kb: "150" }), "");
  assert.equal(noopReason("compress", { by: "quality", kb: "" }), "");
  assert.match(noopReason("rotate", { angle: 0, flipH: false, flipV: false }), /rotation or a flip/);
  assert.equal(noopReason("rotate", { angle: 0, flipH: true, flipV: false }), "");
  assert.match(noopReason("crop", { aspect: "free", zoom: 1 }), /aspect ratio or zoom/);
  assert.equal(noopReason("crop", { aspect: "free", zoom: 1.5 }), "");
  assert.equal(noopReason("crop", { aspect: "1:1", zoom: 1 }), "");
  assert.equal(noopReason("compress", { q: 70 }), "");
});

/* Fake encoder: size grows with quality and with pixel area, like a real lossy codec. */
const fake = (base) => async (q, scale = 1) => ({ size: Math.round(base * (0.1 + q) * scale * scale), q, scale });

test("targetBytes", () => {
  assert.equal(targetBytes("200"), 204800);
  assert.equal(targetBytes(""), 0);
  assert.equal(targetBytes("-5"), 0);
  assert.equal(targetBytes("abc"), 0);
});

test("searchQuality: largest quality that fits, in few encodes", async () => {
  const enc = fake(100000);
  const r = await searchQuality(enc, 60000);
  assert.equal(r.fits, true);
  assert.ok(r.out.size <= 60000);
  assert.equal(r.q, 50);                       // 100000 * (0.1 + 0.50) = 60000
  assert.ok((await enc(0.51)).size > 60000);
  assert.ok(r.tries <= 9, `took ${r.tries} encodes`);
});

test("searchQuality: max quality fits -> one encode; min too big -> reports failure", async () => {
  const hi = await searchQuality(fake(1000), 10000);
  assert.deepEqual([hi.fits, hi.q, hi.tries], [true, 95, 1]);
  const lo = await searchQuality(fake(1000000), 1000);
  assert.deepEqual([lo.fits, lo.q, lo.tries], [false, 5, 2]);
});

test("searchQuality never returns a size it didn't see fit (non-monotonic encoder)", async () => {
  const jumpy = async (q) => ({ size: [30, 41, 57].includes(Math.round(q * 100)) ? 99999 : Math.round(q * 1000) });
  const r = await searchQuality(jumpy, 600);
  assert.equal(r.fits, true);
  assert.ok(r.out.size <= 600);
});

test("fitToTarget: steps dimensions down when quality alone can't reach the target", async () => {
  const r = await fitToTarget(fake(100000), 5000, { longest: 4000 });
  assert.equal(r.fits, true);
  assert.ok(r.scale < 1);
  assert.ok(r.out.size <= 5000);
  const full = await fitToTarget(fake(100000), 60000, { longest: 4000 });
  assert.deepEqual([full.scale, full.q], [1, 50]);
});

test("fitToTarget: lossless ignores quality; unreachable targets return the smallest attempt", async () => {
  const seen = [];
  const png = async (q, scale) => { seen.push(q); return { size: Math.round(80000 * scale * scale) }; };
  const ok = await fitToTarget(png, 20000, { lossy: false, longest: 2000 });
  assert.deepEqual([ok.fits, ok.scale, ok.q], [true, 0.4, null]);
  assert.ok(seen.every((q) => q === 1));
  const nope = await fitToTarget(fake(1e9), 10, { longest: 100 });
  assert.equal(nope.fits, false);
  assert.equal(nope.scale, 0.2);               // 0.1 would make the 100px side 10px < minSide 16
  assert.equal(nope.q, 5);
});
