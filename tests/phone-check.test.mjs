import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNumber, validityText } from "../src/lib/phoneCheck.js";

test("mobile, landline and ambiguous numbers are typed correctly", async () => {
  const m = await analyzeNumber("+919876543210");
  assert.deepEqual([m.valid, m.typeLabel, m.country], [true, "Mobile", "IN"]);
  const l = await analyzeNumber("+442071838750");
  assert.deepEqual([l.valid, l.typeLabel, l.country], [true, "Landline", "GB"]);
  assert.equal((await analyzeNumber("+14165550199")).typeLabel, "Landline or mobile");
});

test("invalid numbers are reported honestly, not as valid", async () => {
  const bad = await analyzeNumber("+919999");
  assert.equal(bad.valid, false); assert.equal(validityText(bad), "Not a valid number"); assert.equal(bad.typeLabel, null);
  const right = await analyzeNumber("+912212345678");
  assert.equal(right.valid, false); assert.equal(validityText(right), "Right length, but not a valid number");
  assert.equal(validityText(await analyzeNumber("+81312345678")), "Valid number");
});

test("unparseable input returns null", async () => {
  assert.equal(await analyzeNumber("hello"), null);
});
