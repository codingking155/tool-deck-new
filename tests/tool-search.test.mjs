import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../src/toolsMeta.js";
import { searchTools, matchText, highlightRuns } from "../src/lib/toolSearch.js";
import { readRecent, pushRecent, clearRecent, RECENT_MAX } from "../src/lib/recentTools.js";

const top = (q) => searchTools(TOOLS, q)[0]?.tool.id;

test("short queries land on the expected tool first", () => {
  assert.equal(top("utc"), "utc");
  assert.equal(top("json"), "json");
  assert.equal(top("pdf"), "pdf");
  assert.equal(top("phone"), "phone");
  assert.equal(top("shop"), "shopifydetector");
  assert.equal(top("speed"), "speed");
  assert.equal(top("ipv6"), "ip");
});

test("aliases and fuzzy subsequences match", () => {
  assert.equal(top("mp3"), "ytdownloader");
  assert.equal(top("wifi"), "speed");
  assert.equal(top("compress jpg"), "image");
  assert.equal(top("jsf"), "json");
  assert.equal(top("certificate"), "ssl");
});

test("empty query returns every tool in registry order; nonsense returns nothing", () => {
  assert.deepEqual(searchTools(TOOLS, "  ").map((r) => r.tool.id), TOOLS.map((t) => t.id));
  assert.equal(searchTools(TOOLS, "zzqxv").length, 0);
});

test("highlight indices map back onto the name", () => {
  const m = matchText("JSON Formatter & Validator", "form");
  assert.deepEqual(m.idx, [5, 6, 7, 8]);
  const runs = highlightRuns("JSON Formatter", m.idx);
  assert.deepEqual(runs, [{ text: "JSON ", hit: false }, { text: "Form", hit: true }, { text: "atter", hit: false }]);
});

test("recent tools: newest first, deduped, capped, tolerant of bad storage", () => {
  const mem = new Map();
  const s = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  pushRecent("utc", s); pushRecent("json", s); pushRecent("utc", s);
  assert.deepEqual(readRecent(null, s), ["utc", "json"]);
  for (const t of TOOLS) pushRecent(t.id, s);
  assert.equal(readRecent(null, s).length, RECENT_MAX);
  assert.deepEqual(readRecent(["utc"], s), []);
  mem.set("toolDeck.recent", "{not json");
  assert.deepEqual(readRecent(null, s), []);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.deepEqual(pushRecent("utc", broken), ["utc"]);
  clearRecent(s);
});
