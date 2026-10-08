import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJSON, repairJSON, formatJSON, minifyJSON, toYAML, toCSV, queryPath, sortKeysDeep, stats, formatPath, toJSONSchema, diffJSON, MAX_DEPTH, utf8Length, lineCol } from "../src/lib/jsonCore.js";
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

test("big integers survive parse → beautify/minify unchanged", async () => {
  const { parseJSON, formatJSON, minifyJSON, toCSV, toYAML } = await import("../src/lib/jsonCore.js");
  const src = '{"id": 12345678901234567890, "n": 1.5, "s": "99999999999999999999", "f": 0.12345678901234567890}';
  const r = parseJSON(src);
  assert.equal(r.ok, true);
  assert.equal(r.bigNumbers, 2);
  assert.equal(minifyJSON(r.value), '{"id":12345678901234567890,"n":1.5,"s":"99999999999999999999","f":0.12345678901234567890}');
  assert.match(formatJSON(r.value, 2), /"id": 12345678901234567890/);
  assert.match(toYAML(r.value), /^id: 12345678901234567890$/m);
  assert.equal(toCSV([r.value]).split("\n")[1].split(",")[0], "12345678901234567890");
  assert.equal(parseJSON('{"a": 9007199254740991}').bigNumbers, 0);
});

test("stringify matches JSON.stringify for ordinary values", async () => {
  const { stringify } = await import("../src/lib/jsonCore.js");
  const v = { a: [1, { b: null, c: "x\n\"y\"" }], d: {}, e: [], f: -0, g: 1e21, "h k": true };
  assert.equal(stringify(v, 2), JSON.stringify(v, null, 2));
  assert.equal(stringify(v, 0), JSON.stringify(v));
  assert.equal(stringify(v, "tab"), JSON.stringify(v, null, "\t"));
});

test("repairJSON fixes common breakage and lists what it changed", async () => {
  const { repairJSON, minifyJSON } = await import("../src/lib/jsonCore.js");
  const broken = `// config
{
  name: 'Asha',   /* inline */
  "tags": ["a", "b",],
  active: True, score: NaN,
  "nested": {"x": 1 "y": 2}
  "smart": “quoted”,
`;
  const r = repairJSON(broken);
  assert.equal(r.ok, true);
  assert.equal(minifyJSON(r.value), '{"name":"Asha","tags":["a","b"],"active":true,"score":null,"nested":{"x":1,"y":2},"smart":"quoted"}');
  for (const f of ["Removed comments", "Added quotes around keys", "Replaced single quotes with double quotes", "Removed trailing commas",
    "Converted Python True/False/None", "Replaced NaN/Infinity with null", "Added missing commas", "Replaced curly “smart” quotes", "Closed unclosed brackets"]) {
    assert.ok(r.fixes.includes(f), `missing fix: ${f} in ${r.fixes}`);
  }
  const nd = repairJSON('{"a":1}\n{"a":2}\n');
  assert.equal(minifyJSON(nd.value), '[{"a":1},{"a":2}]');
  assert.ok(nd.fixes[0].includes("NDJSON"));
  assert.equal(repairJSON("{ : }").ok, false);
  const proto = repairJSON('{"__proto__": {"polluted": 1}}');
  assert.equal(Object.keys(proto.value)[0], "__proto__");
  assert.equal({}.polluted, undefined);
});

test("queryPath recursive descent", async () => {
  const { queryPath } = await import("../src/lib/jsonCore.js");
  const d = { a: { id: 1, b: [{ id: 2 }, { c: { id: 3 } }] } };
  assert.deepEqual(queryPath(d, "$..id").matches, [1, 2, 3]);
});

test("diffJSON matches array items by id and reports paths", async () => {
  const { diffJSON, formatPath } = await import("../src/lib/jsonCore.js");
  const a = { users: [{ id: 1, name: "A" }, { id: 2, name: "B" }], v: 1, gone: true };
  const b = { users: [{ id: 0, name: "Z" }, { id: 1, name: "A" }, { id: 2, name: "Bee" }], v: "1", extra: [1] };
  const d = diffJSON(a, b).changes.map((c) => `${c.kind} ${formatPath(c.path)}`);
  assert.deepEqual(d, ["changed $.users[id=2].name", "added $.users[id=0]", "changed $.v", "removed $.gone", "added $.extra"]);
  assert.equal(diffJSON({ a: [1, 2] }, { a: [1, 2] }).changes.length, 0);
  assert.equal(formatPath(["a b", 0, "c"]), "$['a b'][0].c");
});

test("TypeScript and JSON Schema generation merge array samples", async () => {
  const { toTypeScript, toJSONSchema } = await import("../src/lib/jsonCore.js");
  const v = { users: [{ id: 1, name: "A", tags: ["x"] }, { id: 2, name: null, email: "e@x" }], "total-count": 2, meta: {} };
  assert.equal(toTypeScript(v), [
    "export interface Root {\n  users: User[];\n  \"total-count\": number;\n  meta: Record<string, unknown>;\n}",
    "export interface User {\n  id: number;\n  name: string | null;\n  tags?: string[];\n  email?: string;\n}",
  ].join("\n\n"));
  assert.equal(toTypeScript([1, "a"]), "export type Root = (string | number)[];");
  const s = toJSONSchema(v);
  assert.deepEqual(s.properties.users.items.required, ["id", "name"]);
  assert.deepEqual(s.properties.users.items.properties.name, { type: ["string", "null"] });
  assert.deepEqual(toJSONSchema([1, 2.5]).items, { type: "number" });
});

test("innerJSON detects stringified JSON", async () => {
  const { innerJSON, parseJSON } = await import("../src/lib/jsonCore.js");
  assert.ok(innerJSON(parseJSON('"{\\"a\\":1}"').value));
  assert.equal(innerJSON("hello"), null);
});

test("deep nesting returns an error instead of overflowing the stack", () => {
  const n = 100000, deep = "[".repeat(n) + "]".repeat(n);
  const r = parseJSON(deep);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /levels deep/);
  assert.match(parseJSON(deep + "x").error.message, /levels deep/); // locateError path
  assert.equal(repairJSON(deep.slice(0, -5)).ok, false);
  const ok = "[".repeat(MAX_DEPTH) + "]".repeat(MAX_DEPTH);
  assert.equal(parseJSON(ok).ok, true);
  assert.equal(stats(parseJSON(ok).value, ok).depth, MAX_DEPTH - 1);
  let v = []; for (let i = 0; i < n; i++) v = [v]; // stats itself is iterative
  assert.equal(stats(v, "").depth, n);
});

test("queryPath wildcard over a very large array (no spread overflow)", () => {
  const a = Array.from({ length: 200000 }, (_, i) => i);
  assert.equal(queryPath({ a }, "$.a[*]").matches.length, 200000);
});

test("formatPath round-trips through queryPath for awkward keys", () => {
  for (const k of ["it's", 'a"b', "a b", "back\\slash", "x-y", "", "0", "it\\'s"]) {
    const p = formatPath(["root", k]);
    assert.deepEqual(queryPath({ root: { [k]: 7 } }, p).matches, [7], p);
  }
});

test("JSON Schema keeps a __proto__ key as a property", () => {
  const v = parseJSON('{"__proto__": {"x": 1}, "a": 2}').value;
  const s = toJSONSchema(v);
  assert.ok(Object.prototype.hasOwnProperty.call(s.properties, "__proto__"));
  assert.match(JSON.stringify(s), /"__proto__":\{"type":"object"/);
});

test("non-finite and underflowing numbers are kept verbatim", () => {
  const r = parseJSON('[1e400, -1E+999, 1e-400, 1.5]');
  assert.equal(r.bigNumbers, 3);
  assert.equal(minifyJSON(r.value), "[1e400,-1E+999,1e-400,1.5]");
});

test("YAML quotes keys with trailing spaces", () => {
  assert.equal(toYAML({ "a ": 1, b: 2 }), '"a ": 1\nb: 2');
});

test("diff limit is enforced inside add/remove loops", () => {
  const b = Array.from({ length: 5000 }, (_, i) => i);
  const r = diffJSON([], b, 100);
  assert.equal(r.changes.length, 100);
  assert.equal(r.truncated, true);
  const o = Object.fromEntries(b.map((i) => [`k${i}`, i]));
  assert.equal(diffJSON({}, o, 50).changes.length, 50);
  assert.equal(diffJSON(o, {}, 50).changes.length, 50);
});

test("utf8Length matches TextEncoder, including astral and lone surrogates", () => {
  for (const s of ["", "abc", "é", "€", "😀", "a😀b", "\ud800x", "\udc00", "日本語", '{"k":"✓"}'])
    assert.equal(utf8Length(s), new TextEncoder().encode(s).length, JSON.stringify(s));
});

test("lineCol counts lines and columns (1-based)", () => {
  assert.deepEqual(lineCol("abc", 1), { line: 1, col: 2 });
  assert.deepEqual(lineCol("a\nbc\nd", 3), { line: 2, col: 2 });
  assert.deepEqual(lineCol("a\n", 1), { line: 1, col: 2 }); // the newline itself is still on line 1
});

test("lenient parse: fast paths keep __proto__ as data and big numbers exact", () => {
  const r = repairJSON("{__proto__: {x: 1}, 'a': 12345678901234567890, b: 1.5, c: 007,}");
  assert.ok(r.ok);
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.deepEqual(Object.keys(r.value), ["__proto__", "a", "b", "c"]);
  assert.equal(String(r.value.a), "12345678901234567890");
  assert.equal(r.value.b, 1.5);
  assert.equal(r.value.c, 7);
});
