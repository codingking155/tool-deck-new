import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  parseRanges, mergePdfs, extractPages, removePages, splitPdf, rotatePdf,
  addPageNumbers, addWatermark, cropPdf, rebuildPdf, imagesToPdf, pageCount,
} from "../src/lib/pdf.js";

async function make(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([300 + i, 400]);
  return d.save();
}

test("parseRanges", () => {
  assert.deepEqual(parseRanges("1-3, 5", 6), [0, 1, 2, 4]);
  assert.deepEqual(parseRanges("4-", 6), [3, 4, 5]);
  assert.deepEqual(parseRanges("-2", 6), [0, 1]);
  assert.deepEqual(parseRanges("3-1", 6), [2, 1, 0]);
  assert.throws(() => parseRanges("9", 6), /outside/);
  assert.throws(() => parseRanges("a", 6), /Invalid/);
  assert.throws(() => parseRanges(" , ", 6), /at least one/);
});

test("merge, extract, remove, split", async () => {
  const a = await make(3), b = await make(2);
  assert.equal(await pageCount(await mergePdfs([a, b])), 5);
  assert.equal(await pageCount(await extractPages(a, "2-3")), 2);
  assert.equal(await pageCount(await removePages(a, "1")), 2);
  await assert.rejects(removePages(a, "1-3"), /every page/);
  assert.equal((await splitPdf(a, "")).length, 3);
  const parts = await splitPdf(a, "1-2, 3");
  assert.deepEqual(await Promise.all(parts.map(pageCount)), [2, 1]);
});

test("rotate, numbers, watermark, crop, rebuild", async () => {
  const a = await make(2);
  const r = await PDFDocument.load(await rotatePdf(a, 90, "2"));
  assert.equal(r.getPage(0).getRotation().angle, 0);
  assert.equal(r.getPage(1).getRotation().angle, 90);
  assert.equal(await pageCount(await addPageNumbers(a, { position: "top-right" })), 2);
  assert.equal(await pageCount(await addWatermark(a, { text: "DRAFT" })), 2);
  await assert.rejects(addWatermark(a, { text: " " }), /watermark/);
  const c = await PDFDocument.load(await cropPdf(a, { top: 10, left: 20 }));
  assert.equal(c.getPage(0).getCropBox().width, 280);
  await assert.rejects(cropPdf(a, { left: 400 }), /no page area/);
  assert.equal(await pageCount(await rebuildPdf(a)), 2);
});

test("imagesToPdf embeds a PNG", async () => {
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const out = await imagesToPdf([{ bytes: png, type: "png" }, { bytes: png, type: "png" }], { fit: "a4", margin: 10 });
  assert.equal(await pageCount(out), 2);
});
