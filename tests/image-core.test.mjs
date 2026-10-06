import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtBytes, resizeDims, fitMax, cropRect, outName } from "../src/lib/imageCore.mjs";
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
