import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { diffWords, tokenize, diffStats, pixelDiff } from "../src/lib/compare.js";
import { placeImages } from "../src/lib/pdf.js";

const show = (ops) => ops.map((o) => (o.t === "eq" ? o.w : o.t === "add" ? `+${o.w}` : `-${o.w}`)).join(" ");

test("diffWords marks insertions and deletions", () => {
  const ops = diffWords(tokenize("the quick brown fox"), tokenize("the slow brown fox jumps"));
  assert.equal(show(ops), "the -quick +slow brown fox +jumps");
  assert.deepEqual(diffStats(ops), { added: 2, removed: 1, changed: true });
});

test("identical and empty inputs", () => {
  assert.equal(diffStats(diffWords(["a", "b"], ["a", "b"])).changed, false);
  assert.equal(show(diffWords([], ["x"])), "+x");
  assert.equal(show(diffWords(["x"], [])), "-x");
});

test("huge divergent inputs fall back to a block replace instead of exhausting memory", () => {
  const a = Array.from({ length: 4000 }, (_, i) => `a${i}`), b = Array.from({ length: 4000 }, (_, i) => `b${i}`);
  const s = diffStats(diffWords(a, b));
  assert.deepEqual([s.added, s.removed], [4000, 4000]);
});

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = f(i % w, Math.floor(i / w)); d.set([v, v, v, 255], i * 4); } return { width: w, height: h, data: d }; };

test("pixelDiff: identical = 0%, one changed quadrant = 25%, size mismatch counts as different", () => {
  const a = img(10, 10, () => 255);
  assert.equal(pixelDiff(a, a).percent, 0);
  const b = img(10, 10, (x, y) => (x < 5 && y < 5 ? 0 : 255));
  assert.equal(pixelDiff(a, b).percent, 25);
  const tall = img(10, 20, () => 255);
  assert.equal(pixelDiff(a, tall).percent, 50);
});

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

test("placeImages draws on the chosen page and refuses rotated pages", async () => {
  const d = await PDFDocument.create(); d.addPage([200, 300]); d.addPage([200, 300]);
  const out = await placeImages(await d.save(), [{ page: 1, x: 0.5, y: 0.5, w: 0.4, bytes: PNG, type: "png" }]);
  const r = await PDFDocument.load(out);
  const has = (i) => /Do/.test(Buffer.from(r.getPage(i).node.Contents()?.toString?.() ?? "").toString()) || !!r.getPage(i).node.Resources()?.get(r.context.obj("XObject"));
  assert.equal(has(1), true);
  assert.equal(has(0), false);
  const rot = await PDFDocument.create(); const pg = rot.addPage([100, 100]); pg.setRotation((await import("pdf-lib")).degrees(90));
  await assert.rejects(placeImages(await rot.save(), [{ page: 0, x: 0.5, y: 0.5, w: 0.3, bytes: PNG, type: "png" }]), /rotated/);
});
