import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/csv.js";

test("csvCell quotes commas, quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("a\nb"), '"a\nb"');
  assert.equal(csvCell(null), "");
});

test("csvCell keeps E.164 numbers and formulas as text", () => {
  assert.equal(csvCell("+919876543210"), '"\t+919876543210"');
  assert.equal(csvCell("=HYPERLINK(1)"), '"\t=HYPERLINK(1)"');
  assert.equal(csvCell("-1"), '"\t-1"');
  assert.equal(csvCell("919876543210"), "919876543210");
});
