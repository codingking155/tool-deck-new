import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJSON, formatJSON, minifyJSON, toYAML, toCSV, queryPath, sortKeysDeep } from "../src/lib/jsonCore.js";
import { parsePageRanges, formatBytes } from "../src/lib/pageRanges.js";

test("parseJSON reports line and column of the error", () => {
  const r = parseJSON('{\n  "a": 1,\n  "b": }');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 3);
  assert.equal(r.error.col, 8);
});

test("parseJSON explains common mistakes", () => {
  assert.match(parseJSON('{"a": 1,}').error.message, /Trailing comma/);
  assert.match(parseJSON("{'a': 1}").error.message, /double quotes/);
  assert.match(parseJSON('{"a": 1 "b": 2}').error.message, /missing comma/);
  assert.match(parseJSON('[1, 2').error.message, /end of input/);
  assert.equal(parseJSON('{"a": [1, {"b": "\\u00e9"}]}').ok, true);
});

test("parseJSON flags empty input without an error position", () => {
  const r = parseJSON("   ");
  assert.equal(r.ok, false);
  assert.equal(r.empty, true);
});

test("format, tab indent, sort keys, minify", () => {
  const v = { b: 1, a: { d: 2, c: [3] } };
  assert.equal(formatJSON(v, 2), '{\n  "b": 1,\n  "a": {\n    "d": 2,\n    "c": [\n      3\n    ]\n  }\n}');
  assert.ok(formatJSON(v, "tab").includes('\n\t"b"'));
  assert.equal(minifyJSON(v, true), '{"a":{"c":[3],"d":2},"b":1}');
  assert.deepEqual(Object.keys(sortKeysDeep(v)), ["a", "b"]);
});

test("YAML quotes ambiguous scalars and nests arrays of objects", () => {
  const y = toYAML({ name: "x", flag: "yes", num: "42", list: [{ id: 1, tags: ["a"] }, 2], empty: {} });
  assert.equal(y, 'name: x\nflag: "yes"\nnum: "42"\nlist:\n  - id: 1\n    tags:\n      - a\n  - 2\nempty: {}');
});

test("CSV uses the union of keys and escapes quotes/commas", () => {
  assert.equal(toCSV([{ a: 1, b: 'x,"y"' }, { c: true }]), 'a,b,c\n1,"x,""y""",\n,,true');
  assert.equal(toCSV({ a: 1 }), null);
});

test("queryPath handles nested keys, indexes, quotes and wildcards", () => {
  const d = { users: [{ name: "A", "full name": "A B" }, { name: "C" }] };
  assert.deepEqual(queryPath(d, "$.users[0].name").matches, ["A"]);
  assert.deepEqual(queryPath(d, "$.users[-1].name").matches, ["C"]);
  assert.deepEqual(queryPath(d, "$.users[*].name").matches, ["A", "C"]);
  assert.deepEqual(queryPath(d, "$.users[0]['full name']").matches, ["A B"]);
  assert.deepEqual(queryPath(d, "$.nope").matches, []);
  assert.equal(queryPath(d, "users").ok, false);
});

test("parsePageRanges groups and validates", () => {
  assert.deepEqual(parsePageRanges("1-3, 5, 7-", 8).groups, [[0, 1, 2], [4], [6, 7]]);
  assert.equal(parsePageRanges("9", 8).ok, false);
  assert.equal(parsePageRanges("3-1", 8).ok, false);
  assert.equal(parsePageRanges("a", 8).ok, false);
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("zip: crc32, unique names, and a STORE archive that unzip accepts", async () => {
  const { crc32, uniqueNames, makeZip } = await import("../src/lib/zip.js");
  const enc = new TextEncoder();
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.deepEqual(uniqueNames(["a.jpg", "A.jpg", "b"]), ["a.jpg", "A (2).jpg", "b"]);
  const zip = makeZip([{ name: "hi.txt", data: enc.encode("hello") }, { name: "hi.txt", data: enc.encode("world") }]);
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "zt-"));
  writeFileSync(join(dir, "t.zip"), zip);
  let listing;
  try { listing = execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print([(i.filename,z.read(i).decode()) for i in z.infolist()])", join(dir, "t.zip")]).toString(); }
  catch (e) { if (e.code === "ENOENT") return; throw e; }
  assert.match(listing, /\('hi\.txt', 'hello'\), \('hi \(2\)\.txt', 'world'\)/);
});
