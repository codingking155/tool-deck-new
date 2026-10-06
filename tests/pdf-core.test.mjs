import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { inflateSync } from "node:zlib";
import {
  parseRanges, mergePdfs, extractPages, removePages, splitPdf, rotatePdf,
  addPageNumbers, addWatermark, cropPdf, rebuildPdf, imagesToPdf, pageCount, jpegOrientation,
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

test("encrypted PDFs are refused for edits but still counted", async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  d.context.trailerInfo.Encrypt = d.context.register(d.context.obj({ Filter: "Standard", V: 1, R: 2 }));
  const enc = await d.save({ useObjectStreams: false });
  assert.equal(await pageCount(enc), 1);
  for (const op of [() => rotatePdf(enc, 90), () => rebuildPdf(enc), () => splitPdf(enc, ""), () => mergePdfs([enc])])
    await assert.rejects(op(), /encrypted.*Unlock PDF/);
});

test("crop and page numbers follow an offset CropBox", async () => {
  const d = await PDFDocument.create();
  d.addPage([400, 400]).setCropBox(50, 60, 200, 300);
  const src = await d.save();
  const cb = (await PDFDocument.load(await cropPdf(src, { left: 10, bottom: 20, top: 5, right: 5 }))).getPage(0).getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [60, 80, 185, 275]);
  await assert.rejects(cropPdf(src, { left: 195 }), /no page area/);
  const stream = async (bytes) => {
    const p = (await PDFDocument.load(bytes)).getPage(0);
    return p.node.normalizedEntries().Contents.asArray().map((r) => {
      const st = p.doc.context.lookup(r), raw = Buffer.from(st.getContents());
      return (String(st.dict.get(PDFName.of("Filter"))) === "/FlateDecode" ? inflateSync(raw) : raw).toString("latin1");
    }).join("\n");
  };
  const tm = (await stream(await addPageNumbers(src, { position: "bottom-left" }))).match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/);
  assert.deepEqual([Number(tm[1]), Number(tm[2])], [50 + 36, 60 + 28]);
});

test("jpegOrientation reads the EXIF tag", () => {
  const exif = (le, v) => {
    const t = le ? [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, v, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      : [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
    return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body, 0xff, 0xda, 0, 2]);
  };
  assert.equal(jpegOrientation(exif(true, 6)), 6);
  assert.equal(jpegOrientation(exif(false, 8)), 8);
  assert.equal(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);
  assert.equal(jpegOrientation(new Uint8Array([1, 2, 3])), 1);
});
