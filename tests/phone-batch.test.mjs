import test from "node:test";
import assert from "node:assert/strict";
import { rowTimes, sortRows, nextSort, loadDraft, saveDraft, DRAFT_KEY, DRAFT_MAX } from "../src/lib/phoneBatch.js";
import { detectPhone, nationalDigits } from "../src/lib/phone.js";
import { nationalToE164 } from "../src/lib/phoneCheck.js";

const AT = new Date("2026-07-13T10:30:00Z");

test("rowTimes: local time, short label and rank; blank for no zone", () => {
  const ist = rowTimes("Asia/Kolkata", AT); // 16:00
  assert.deepEqual([ist.local, ist.mins, ist.tone, ist.label, ist.rank], ["16:00", 960, "good", "Business hours", 0]);
  assert.equal(rowTimes("America/New_York", AT).tone, "bad"); // 06:30
  assert.deepEqual([rowTimes("", AT).local, rowTimes(undefined, AT).mins], ["", null]);
  assert.equal(rowTimes("Not/AZone", AT).local, "");
});

const rows = [
  { input: "b", country: "India", zone: "Asia/Kolkata", status: "Valid" },
  { input: "a10", country: "", zone: "", status: "Not detected" },
  { input: "a9", country: "United States", zone: "America/New_York", status: "Valid" },
  { input: "c", country: "United Kingdom", zone: "Europe/London", status: "Valid" }, // 11:30
];
const times = (r) => rowTimes(r.zone, AT);
const ids = (l) => l.map((r) => r.input);

test("sortRows: strings use natural order; blanks always last; stable; input untouched", () => {
  assert.deepEqual(ids(sortRows(rows, "input", "asc", times)), ["a9", "a10", "b", "c"]);
  assert.deepEqual(ids(sortRows(rows, "country", "asc", times)), ["b", "c", "a9", "a10"]);
  assert.deepEqual(ids(sortRows(rows, "country", "desc", times)), ["a9", "c", "b", "a10"]);
  assert.deepEqual(ids(sortRows(rows, "status", "asc", times)), ["a10", "b", "a9", "c"]);
  assert.deepEqual(ids(rows), ["b", "a10", "a9", "c"]);
  assert.equal(sortRows(rows, "nope"), rows);
});

test("sortRows: local time by minutes of day; call window best-first then by time", () => {
  assert.deepEqual(ids(sortRows(rows, "local", "asc", times)), ["a9", "c", "b", "a10"]); // 06:30, 11:30, 16:00
  assert.deepEqual(ids(sortRows(rows, "local", "desc", times)), ["b", "c", "a9", "a10"]);
  assert.deepEqual(ids(sortRows(rows, "call", "asc", times)), ["c", "b", "a9", "a10"]); // good 11:30, good 16:00, bad
});

test("nextSort cycles asc -> desc -> off; a new column starts asc", () => {
  assert.deepEqual(nextSort(null, "country"), { key: "country", dir: "asc" });
  assert.deepEqual(nextSort({ key: "country", dir: "asc" }, "country"), { key: "country", dir: "desc" });
  assert.equal(nextSort({ key: "country", dir: "desc" }, "country"), null);
  assert.deepEqual(nextSort({ key: "country", dir: "desc" }, "local"), { key: "local", dir: "asc" });
});

function fakeStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("draft round-trips; empty/oversized drafts clear the key; bad data and throwing storage are safe", () => {
  const st = fakeStorage();
  saveDraft(st, { text: "020 7183 8750", region: "GB" });
  assert.deepEqual(loadDraft(st), { text: "020 7183 8750", region: "GB" });
  saveDraft(st, { text: "x".repeat(DRAFT_MAX + 1), region: "GB" });
  assert.equal(st.m.has(DRAFT_KEY), false);
  saveDraft(st, { text: "1", region: "" }); saveDraft(st, { text: "", region: "" });
  assert.equal(st.m.has(DRAFT_KEY), false);
  st.setItem(DRAFT_KEY, "{not json"); assert.equal(loadDraft(st), null);
  st.setItem(DRAFT_KEY, JSON.stringify({ text: "1", region: "<script>" })); assert.deepEqual(loadDraft(st), { text: "1", region: "" });
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("x"); } };
  assert.equal(loadDraft(boom), null);
  assert.doesNotThrow(() => saveDraft(boom, { text: "1", region: "" }));
});

test("nationalDigits: trunk and assumed-prefix numbers re-read in a picked country; + numbers don't", async () => {
  assert.equal(nationalDigits(detectPhone("020 7183 8750")), "02071838750");
  assert.equal(nationalDigits(detectPhone("98765 43210")), "9876543210"); // prefix only guessed (+98 Iran)
  assert.equal(nationalDigits(detectPhone("+44 20 7183 8750")), null);
  assert.equal(nationalDigits(null), null);
  assert.equal(await nationalToE164(nationalDigits(detectPhone("020 7183 8750")), "GB"), "+442071838750");
  assert.equal(await nationalToE164(nationalDigits(detectPhone("98765 43210")), "IN"), "+919876543210");
});
