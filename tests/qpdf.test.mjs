import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { protectPdf, unlockPdf } from "../src/lib/qpdf.js";

// Node can't fetch() a file path, so hand the wasm binary to the module directly.
const rq = createRequire(import.meta.url);
const wbin = readFileSync(rq.resolve("@jspawn/qpdf-wasm").replace(/qpdf\.js$/, "qpdf.wasm"));
const rt = { env: { instantiateWasm(imports, cb) { WebAssembly.instantiate(wbin, imports).then((r) => cb(r.instance, r.module)); return {}; } } };

const make = async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); d.addPage([200, 200]); return d.save(); };

test("protect -> encrypted; wrong/no password fails; right password unlocks all pages", async () => {
  const enc = await protectPdf(await make(), { userPassword: "s3cret!", allowPrint: false }, rt);
  assert.ok(Buffer.from(enc).toString("latin1").includes("/Encrypt"));
  await assert.rejects(PDFDocument.load(enc));
  await assert.rejects(unlockPdf(enc, "", rt), /needs a password/);
  await assert.rejects(unlockPdf(enc, "wrong", rt), /incorrect/);
  const back = await unlockPdf(enc, "s3cret!", rt);
  assert.equal((await PDFDocument.load(back)).getPageCount(), 2);
  assert.ok(!Buffer.from(back).toString("latin1").includes("/Encrypt"));
});

test("restrictions-only (no open password): opens without a password but is flagged encrypted; unlock strips it", async () => {
  const enc = await protectPdf(await make(), { allowCopy: false, allowModify: false }, rt);
  assert.ok(Buffer.from(enc).toString("latin1").includes("/Encrypt"));
  const back = await unlockPdf(enc, "", rt);
  assert.equal((await PDFDocument.load(back)).getPageCount(), 2);
  assert.ok(!Buffer.from(back).toString("latin1").includes("/Encrypt"));
});

test("protect refuses a no-op request; passwords with spaces and quotes work", async () => {
  await assert.rejects(protectPdf(await make(), {}, rt), /Set a password/);
  const pw = `a b"c'd é`;
  const enc = await protectPdf(await make(), { userPassword: pw }, rt);
  assert.equal((await PDFDocument.load(await unlockPdf(enc, pw, rt))).getPageCount(), 2);
});

test("unlocking a PDF that isn't encrypted just works", async () => {
  const back = await unlockPdf(await make(), "", rt);
  assert.equal((await PDFDocument.load(back)).getPageCount(), 2);
});
