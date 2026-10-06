import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { zipFiles } from "../src/lib/zip.js";
import { addWatermark, pageCount } from "../src/lib/pdf.js";

test("zipFiles round-trips contents and de-duplicates names", async () => {
  const blob = await zipFiles([
    { name: "a.pdf", blob: new Blob(["one"]) }, { name: "a.pdf", blob: new Blob(["two"]) },
    { name: "b.jpg", blob: new Blob(["three"]) }, { name: "noext", blob: new Blob(["x"]) }, { name: "noext", blob: new Blob(["y"]) },
  ]);
  const z = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.deepEqual(Object.keys(z.files).sort(), ["a (2).pdf", "a.pdf", "b.jpg", "noext", "noext (2)"]);
  assert.equal(await z.file("a (2).pdf").async("string"), "two");
});

const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf"].find(existsSync);
const base = async () => { const d = await PDFDocument.create(); d.addPage([300, 300]); d.addPage([300, 300]); return d.save(); };

test("watermark: non-Latin text is refused with a helpful message on the default font", async () => {
  await assert.rejects(addWatermark(await base(), { text: "Привет" }), /default font can't draw/);
  assert.equal(await pageCount(await addWatermark(await base(), { text: "DRAFT" })), 2);
});

test("watermark: a custom Unicode font draws Cyrillic/Greek", { skip: !FONT && "no system font available" }, async () => {
  const out = await addWatermark(await base(), { text: "Привет Ελλάδα", fontBytes: readFileSync(FONT) });
  assert.equal(await pageCount(out), 2);
  assert.ok(out.length > 2000, "font subset should be embedded");
});

test("watermark: a corrupt font file is rejected clearly", async () => {
  await assert.rejects(addWatermark(await base(), { text: "X", fontBytes: new Uint8Array([1, 2, 3, 4]) }), /couldn't be read/);
});
