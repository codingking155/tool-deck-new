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

test("detectPhone handles links, extensions and national trunk prefixes", async () => {
  const { detectPhone } = await import("../src/lib/phone.js");
  assert.equal(detectPhone("tel:+442071838750").e164, "+442071838750");
  assert.equal(detectPhone("https://wa.me/919876543210").e164, "+919876543210");
  const x = detectPhone("+44 20 7183 8750 ext. 204");
  assert.deepEqual([x.e164, x.ext], ["+442071838750", "204"]);
  const t = detectPhone("020 7183 8750");
  assert.deepEqual([t.trunk, t.digits], [true, "02071838750"]);
});

test("national numbers convert to E.164 via the chosen region, and expose a tel: URI", async () => {
  const { nationalToE164 } = await import("../src/lib/phoneCheck.js");
  assert.equal(await nationalToE164("02071838750", "GB"), "+442071838750");
  assert.equal(await nationalToE164("0", "GB"), null);
  const a = await analyzeNumber("+442071838750");
  assert.deepEqual([a.international, a.rfc3966], ["+44 20 7183 8750", "tel:+442071838750"]);
});
