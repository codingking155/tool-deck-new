/* Pure JSON helpers — no DOM, so tests/json-core.test.mjs can import them. */

/* A number JSON.parse would round (IDs like 12345678901234567890). Kept as
   its original text so beautify/minify never silently change it. */
const MARK = `\u0000big${Math.random().toString(36).slice(2, 8)}:`;
const MARK_RE = new RegExp(`"${JSON.stringify(MARK).slice(1, -1).replace(/\\/g, "\\\\")}([-+.\\deE]+)"`, "g");
export class BigNum {
  constructor(raw) { this.raw = raw; }
  toString() { return this.raw; }
  /* Native JSON.stringify emits a marked string; stringify() swaps it back to the bare number. */
  toJSON() { return MARK + this.raw; }
}
export const isContainer = (v) => v !== null && typeof v === "object" && !(v instanceof BigNum);

/* The converters, tree and diff recurse per level; past this the browser stack overflows. */
export const MAX_DEPTH = 1000;
const DEEP_MSG = `Nested more than ${MAX_DEPTH.toLocaleString("en")} levels deep — too deep to process safely in the browser`;
function tooDeep(root) {
  const stack = [root, 0];
  while (stack.length) {
    const d = stack.pop(), v = stack.pop();
    if (!isContainer(v)) continue;
    if (d >= MAX_DEPTH) return true;
    for (const c of Array.isArray(v) ? v : Object.values(v)) stack.push(c, d + 1);
  }
  return false;
}

export function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let j = text.indexOf("\n"); j !== -1 && j < pos; j = text.indexOf("\n", j + 1)) { line++; last = j; }
  return { line, col: pos - last };
}

/* Engines word (or omit) error positions differently, so locate the first
   error ourselves with a minimal scanner. Only runs after JSON.parse fails. */
function locateError(s) {
  let i = 0;
  const fail = (msg) => { throw { pos: i, msg }; };
  const ws = () => { for (let c = s.charCodeAt(i); c === 32 || c === 9 || c === 10 || c === 13; c = s.charCodeAt(++i)); };
  const NUM = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y; // sticky: matches at i without copying the rest of the text
  const show = () => (i >= s.length ? "end of input" : `"${s[i]}"`);
  const value = (depth = 0) => {
    ws();
    const c = s[i];
    if ((c === "{" || c === "[") && depth >= MAX_DEPTH) fail(DEEP_MSG);
    if (c === "{") {
      i++; ws();
      if (s[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(s[i] === "'" ? "Keys need double quotes, not single quotes" : s[i] === "}" ? "Trailing comma before }" : `Expected a "quoted" key but found ${show()}`);
        str(); ws();
        if (s[i] !== ":") fail(`Expected ":" after the key but found ${show()}`);
        i++; value(depth + 1); ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return; }
        fail(`Expected "," or "}" but found ${show()} — missing comma?`);
      }
    }
    if (c === "[") {
      i++; ws();
      if (s[i] === "]") { i++; return; }
      for (;;) {
        ws();
        if (s[i] === "]") fail("Trailing comma before ]");
        value(depth + 1); ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return; }
        fail(`Expected "," or "]" but found ${show()} — missing comma?`);
      }
    }
    if (c === '"') return str();
    if (c === "'") fail("Strings need double quotes, not single quotes");
    if (c === "-" || (c >= "0" && c <= "9")) {
      NUM.lastIndex = i;
      if (!NUM.test(s)) fail("Invalid number");
      i = NUM.lastIndex; return;
    }
    for (const lit of ["true", "false", "null"]) if (s.startsWith(lit, i)) { i += lit.length; return; }
    fail(i >= s.length ? "Unexpected end of input — something isn't closed" : `Unexpected ${show()}`);
  };
  const str = () => {
    i++;
    while (i < s.length && s[i] !== '"') {
      const c = s.charCodeAt(i);
      if (c >= 0x20 && c !== 92) { i++; continue; } // plain character: the common case
      if (c === 92) {
        i++;
        if (s[i] === "u") { if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 1, i + 5))) fail("Bad \\u escape"); i += 5; continue; }
        if (!'"\\/bfnrt'.includes(s[i])) fail(`Invalid escape "\\${s[i] ?? ""}"`);
      } else if (s.charCodeAt(i) < 0x20) fail("Unescaped line break or control character inside a string");
      i++;
    }
    if (i >= s.length) fail("String is never closed");
    i++;
  };
  try {
    value(); ws();
    if (i < s.length) fail(`Unexpected ${show()} after the end of the JSON`);
    return null;
  } catch (e) {
    if (e && typeof e.pos === "number") return e;
    throw e;
  }
}

const STRICT_NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function unsafeNumber(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return true; // 1e400 → Infinity → null
  if (n === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ""))) return true; // 1e-400 underflows to 0
  if (!/[.eE]/.test(raw)) return !Number.isSafeInteger(n);
  const digits = raw.replace(/^-/, "").replace(/[eE].*$/, "").replace(".", "").replace(/^0+/, "");
  if (digits.length <= 15) return false;
  const back = Number(raw).toPrecision(Math.min(digits.length, 100)).replace(/^-/, "").replace(/e.*$/, "").replace(".", "").replace(/^0+/, "");
  return back !== digits;
}

/* Count numbers in valid JSON text that would lose precision. Skips strings. */
export function countUnsafeNumbers(text) {
  if (!/\d[\d.]{15}|[eE][+-]?\d{3}/.test(text)) return 0;
  const re = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let n = 0, m;
  while ((m = re.exec(text))) if (m[0][0] !== '"' && (m[0].replace(/^-/, "").length > 15 || /[eE][+-]?\d{3}/.test(m[0])) && unsafeNumber(m[0])) n++;
  return n;
}

/* Forgiving parser: accepts comments, single/curly quotes, unquoted keys,
   trailing/missing commas, Python literals, NaN, unclosed brackets and NDJSON.
   Records every kind of fix so the UI can say what changed. */
function parseLenient(src) {
  let i = 0;
  const fixes = new Set();
  let bigs = 0;
  const err = (m) => { const e = new Error(m); e.pos = i; throw e; };
  const show = () => (i >= src.length ? "end of input" : `"${src[i]}"`);
  const CLOSE = { '"': ['"'], "'": ["'"], "`": ["`"], "“": ["”", '"', "“"], "‘": ["’", "'"] };
  const ESC = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  const ID = /[A-Za-z_$][\w$-]*/y;
  const NUMKEY = /-?\d+(?:\.\d+)?/y;
  const NUM = /[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
  const WORD = /[A-Za-z_$][\w$]*/y;
  const sticky = (re) => { re.lastIndex = i; const m = re.exec(src); if (m) i = re.lastIndex; return m && m[0]; };

  const ws = () => {
    for (;;) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      if (c === "﻿" || c === " " || c === "​") { i++; fixes.add("Removed invisible characters"); continue; }
      if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; fixes.add("Removed comments"); continue; }
      if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; fixes.add("Removed comments"); continue; }
      return;
    }
  };

  const str = () => {
    const open = src[i];
    const close = CLOSE[open];
    if (open === "'") fixes.add("Replaced single quotes with double quotes");
    else if (open === "`") fixes.add("Replaced backticks with double quotes");
    else if (open !== '"') fixes.add("Replaced curly “smart” quotes");
    i++;
    let out = "";
    while (i < src.length) {
      /* copy a run of plain characters in one slice instead of one at a time */
      let j = i;
      for (let ch = src[j]; j < src.length && ch !== "\\" && ch >= " " && !close.includes(ch); ch = src[++j]);
      if (j > i) { out += src.slice(i, j); i = j; if (i >= src.length) break; }
      const c = src[i];
      if (close.includes(c)) { i++; return out; }
      if (c === "\\") {
        const n = src[i + 1];
        if (n !== undefined && Object.prototype.hasOwnProperty.call(ESC, n)) { out += ESC[n]; i += 2; continue; }
        if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
        if (n !== open) fixes.add("Fixed invalid escape sequences");
        out += n ?? ""; i += 2; continue;
      }
      if (c < " ") fixes.add("Escaped line breaks and tabs inside strings");
      out += c; i++;
    }
    fixes.add("Closed an unterminated string");
    return out;
  };

  const key = () => {
    if (CLOSE[src[i]]) return str();
    const k = sticky(ID) || sticky(NUMKEY);
    if (k == null) err(`Expected a key but found ${show()}`);
    fixes.add("Added quotes around keys");
    return k;
  };

  /* defineProperty only for "__proto__" (assignment would set the prototype); plain assignment is much faster */
  const set = (o, k, v) => { if (k === "__proto__") Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); else o[k] = v; };

  const value = (depth) => {
    ws();
    const c = src[i];
    if ((c === "{" || c === "[") && depth >= MAX_DEPTH) err(DEEP_MSG);
    if (c === "{") return obj(depth);
    if (c === "[") return arr(depth);
    if (CLOSE[c]) return str();
    if (src.startsWith("-Infinity", i)) { i += 9; fixes.add("Replaced NaN/Infinity with null"); return null; }
    const num = sticky(NUM);
    if (num != null) {
      if (STRICT_NUM.test(num)) { // already valid JSON: skip the rewrites; only long or huge-exponent numbers can lose precision
        if ((num.length > 15 || /[eE][+-]?\d{3}/.test(num)) && unsafeNumber(num)) { bigs++; return new BigNum(num); }
        return Number(num);
      }
      if (/^[+-]?0[xX]/.test(num)) { fixes.add("Converted hex numbers"); return Number(num.replace(/^\+/, "")); }
      let r = num.replace(/^\+/, "").replace(/^(-?)\./, "$10.").replace(/\.(?=[eE]|$)/, "").replace(/^(-?)0+(?=\d)/, "$1");
      if (r !== num) fixes.add("Fixed number formats");
      if (unsafeNumber(r)) { bigs++; return new BigNum(r); }
      return Number(r);
    }
    const w = sticky(WORD);
    if (w != null) {
      if (w === "true") return true;
      if (w === "false") return false;
      if (w === "null") return null;
      if (w === "True" || w === "False" || w === "None") { fixes.add("Converted Python True/False/None"); return w === "None" ? null : w === "True"; }
      if (w === "undefined") { fixes.add("Replaced undefined with null"); return null; }
      if (w === "NaN" || w === "Infinity") { fixes.add("Replaced NaN/Infinity with null"); return null; }
      fixes.add("Quoted bare words as strings");
      return w;
    }
    err(i >= src.length ? "Unexpected end of input" : `Can't repair the ${show()} here`);
  };

  function obj(depth) {
    i++;
    const o = {};
    for (;;) {
      ws();
      if (i >= src.length) { fixes.add("Closed unclosed brackets"); return o; }
      if (src[i] === "}") { i++; return o; }
      if (src[i] === "]") { i++; fixes.add("Fixed mismatched brackets"); return o; }
      if (src[i] === ",") { i++; fixes.add("Removed extra commas"); continue; }
      const k = key();
      ws();
      if (src[i] === ":") i++;
      else if (src[i] === "=") { i++; fixes.add("Replaced = with :"); }
      else fixes.add("Added missing colons");
      set(o, k, value(depth + 1));
      ws();
      if (src[i] === ",") { i++; ws(); if (src[i] === "}") fixes.add("Removed trailing commas"); continue; }
      if (src[i] === "}") { i++; return o; }
      if (i >= src.length) { fixes.add("Closed unclosed brackets"); return o; }
      if (src[i] === "]") { i++; fixes.add("Fixed mismatched brackets"); return o; }
      fixes.add("Added missing commas");
    }
  }

  function arr(depth) {
    i++;
    const a = [];
    for (;;) {
      ws();
      if (i >= src.length) { fixes.add("Closed unclosed brackets"); return a; }
      if (src[i] === "]") { i++; return a; }
      if (src[i] === "}") { i++; fixes.add("Fixed mismatched brackets"); return a; }
      if (src[i] === ",") { i++; fixes.add("Removed extra commas"); continue; }
      a.push(value(depth + 1));
      ws();
      if (src[i] === ",") { i++; ws(); if (src[i] === "]") fixes.add("Removed trailing commas"); continue; }
      if (src[i] === "]") { i++; return a; }
      if (i >= src.length) { fixes.add("Closed unclosed brackets"); return a; }
      if (src[i] === "}") { i++; fixes.add("Fixed mismatched brackets"); return a; }
      fixes.add("Added missing commas");
    }
  }

  ws();
  if (i >= src.length) err("Nothing to parse");
  const items = [value(0)];
  ws();
  while (i < src.length) {
    if (src[i] === "," || src[i] === ";") { i++; ws(); continue; }
    if (src[i] === "}" || src[i] === "]") { i++; fixes.add("Removed extra closing brackets"); ws(); continue; }
    items.push(value(0));
    ws();
  }
  if (items.length > 1) fixes.add("Wrapped multiple top-level values (NDJSON) in an array");
  return { value: items.length > 1 ? items : items[0], fixes: [...fixes], bigNumbers: bigs };
}

export function parseJSON(text) {
  if (!text.trim()) return { ok: false, empty: true, error: { message: "Paste some JSON to start." } };
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    let loc = null;
    try { loc = locateError(text); } catch { /* stack overflow etc. — fall back to the engine's message */ }
    if (!loc) return { ok: false, error: { message: String(e.message || e) } };
    return { ok: false, error: { message: loc.msg, pos: loc.pos, ...lineCol(text, loc.pos) } };
  }
  try {
    if (tooDeep(value)) return { ok: false, error: { message: DEEP_MSG } };
    const bigNumbers = countUnsafeNumbers(text);
    if (bigNumbers) value = parseLenient(text).value;
    return { ok: true, value, bigNumbers };
  } catch (e) {
    return { ok: false, error: { message: String(e?.message || e) } };
  }
}

export function repairJSON(text) {
  try {
    const r = parseLenient(text);
    if (tooDeep(r.value)) throw new Error(DEEP_MSG);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: { message: e.message, ...(typeof e.pos === "number" ? { pos: e.pos, ...lineCol(text, e.pos) } : {}) } };
  }
}

/* JSON.stringify that writes BigNum values back verbatim. */
export function stringify(v, indent = 2, sortKeys = false) {
  const s = JSON.stringify(sortKeys ? sortKeysDeep(v) : v, null, indent === "tab" ? "\t" : Number(indent) || undefined) ?? "null";
  return s.includes("big") ? s.replace(MARK_RE, "$1") : s;
}

export function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (isContainer(v)) {
    const o = {};
    for (const k of Object.keys(v).sort()) Object.defineProperty(o, k, { value: sortKeysDeep(v[k]), enumerable: true, writable: true, configurable: true });
    return o;
  }
  return v;
}

export const formatJSON = (value, indent = 2, sortKeys = false) => stringify(value, indent, sortKeys);
export const minifyJSON = (value, sortKeys = false) => stringify(value, 0, sortKeys);

const YAML_PLAIN = /^[A-Za-z_][A-Za-z0-9_ ./-]*$/;
const YAML_RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
function yamlScalar(v) {
  if (v instanceof BigNum) return v.raw;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (s && YAML_PLAIN.test(s) && !YAML_RESERVED.test(s) && s.trim() === s) return s;
  return JSON.stringify(s);
}
function yamlKey(k) { return YAML_PLAIN.test(k) && !YAML_RESERVED.test(k) && k.trim() === k ? k : JSON.stringify(k); }
const nonEmpty = (c) => isContainer(c) && (Array.isArray(c) ? c.length : Object.keys(c).length);
const emptyLit = (c) => (Array.isArray(c) ? "[]" : "{}");

export function toYAML(v, ind = 0) {
  const pad = "  ".repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((item) => {
      if (nonEmpty(item) && !Array.isArray(item)) return `${pad}- ${toYAML(item, ind + 1).slice(pad.length + 2)}`;
      if (nonEmpty(item)) return `${pad}-\n${toYAML(item, ind + 1)}`;
      return `${pad}- ${isContainer(item) ? emptyLit(item) : yamlScalar(item)}`;
    }).join("\n");
  }
  if (isContainer(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return keys.map((k) => {
      const c = v[k];
      if (nonEmpty(c)) return `${pad}${yamlKey(k)}:\n${toYAML(c, ind + 1)}`;
      return `${pad}${yamlKey(k)}: ${isContainer(c) ? emptyLit(c) : yamlScalar(c)}`;
    }).join("\n");
  }
  return yamlScalar(v);
}

/* Array of objects → CSV; columns are the union of all keys in first-seen order. */
export function toCSV(v) {
  if (!Array.isArray(v) || !v.length || !v.every((r) => isContainer(r) && !Array.isArray(r))) return null;
  const cols = [];
  const seen = new Set();
  for (const r of v) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const cell = (x) => {
    if (x === undefined || x === null) return "";
    const s = x instanceof BigNum ? x.raw : typeof x === "object" ? stringify(x, 0) : String(x);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(cell).join(","), ...v.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

const unesc = (k) => k.replace(/\\(.)/gs, "$1");

/* Supports $, .key, ['key'], ["key"] (backslash escapes), [0], [-1], [*], .* and ..key (recursive). */
export function queryPath(root, path) {
  const p = path.trim();
  if (!p.startsWith("$")) return { ok: false, error: "Path must start with $" };
  const tokens = [];
  const re = /\.\.([A-Za-z_$][\w$-]*)|\.([A-Za-z_$][\w$-]*)|\.\*|\[(-?\d+)\]|\[\*\]|\[\s*'((?:[^'\\]|\\.)*)'\s*\]|\[\s*"((?:[^"\\]|\\.)*)"\s*\]/y;
  let i = 1;
  while (i < p.length) {
    re.lastIndex = i;
    const m = re.exec(p);
    if (!m) return { ok: false, error: `Can't read the path at "${p.slice(i)}"` };
    if (m[1] !== undefined) tokens.push({ deep: m[1] });
    else if (m[2] !== undefined) tokens.push({ key: m[2] });
    else if (m[3] !== undefined) tokens.push({ index: Number(m[3]) });
    else if (m[4] !== undefined) tokens.push({ key: unesc(m[4]) });
    else if (m[5] !== undefined) tokens.push({ key: unesc(m[5]) });
    else tokens.push({ wild: true });
    i = re.lastIndex;
  }
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  let cur = [root];
  for (const t of tokens) {
    const next = [];
    for (const n of cur) {
      if (!isContainer(n)) continue;
      if (t.wild) { for (const x of Array.isArray(n) ? n : Object.values(n)) next.push(x); } // no spread: >120k args overflows
      else if (t.deep !== undefined) {
        const stack = [n];
        while (stack.length) {
          const x = stack.pop();
          if (!isContainer(x)) continue;
          if (!Array.isArray(x) && has(x, t.deep)) next.push(x[t.deep]);
          const kids = Array.isArray(x) ? x : Object.values(x);
          for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
        }
      } else if (t.index !== undefined) {
        if (Array.isArray(n)) { const v = n[t.index < 0 ? n.length + t.index : t.index]; if (v !== undefined) next.push(v); }
      } else if (!Array.isArray(n) && has(n, t.key)) next.push(n[t.key]);
    }
    cur = next;
  }
  return { ok: true, matches: cur };
}

/** UTF-8 byte length without encoding the whole string (no multi-MB allocation). */
export function utf8Length(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 2; i++; } // pair: 2 units → 4 bytes
    else n += 2; // BMP 3 bytes (lone surrogates encode as U+FFFD, also 3)
  }
  return n;
}

export function stats(value, text) {
  let keys = 0, depth = 0, nodes = 0;
  const stack = [value, 0]; // iterative: deep documents can't overflow the call stack
  while (stack.length) {
    const d = stack.pop(), v = stack.pop();
    nodes++;
    if (d > depth) depth = d;
    if (Array.isArray(v)) for (const x of v) stack.push(x, d + 1);
    else if (isContainer(v)) for (const k of Object.keys(v)) { keys++; stack.push(v[k], d + 1); }
  }
  return { keys, depth, nodes, bytes: utf8Length(text) };
}

export function typeOf(v) {
  if (v === null) return "null";
  if (v instanceof BigNum) return "number";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/* Path segments → "$.users[0]['full name']" (round-trips through queryPath). */
export function formatPath(segs) {
  let s = "$";
  for (const k of segs) {
    if (typeof k === "number") s += `[${k}]`;
    else if (typeof k === "object") s += `[${k.key}=${JSON.stringify(k.value)}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(k)) s += `.${k}`;
    else s += `['${k.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`;
  }
  return s;
}

const ID_KEYS = ["id", "_id", "uuid", "key"];
function idKeyFor(a, b) {
  const all = a.concat(b);
  if (!all.length || !all.every((x) => isContainer(x) && !Array.isArray(x))) return null;
  for (const k of ID_KEYS) {
    const ok = (arr) => {
      const seen = new Set();
      for (const x of arr) {
        const v = x[k];
        if (v === undefined || isContainer(v)) return false;
        const s = String(v);
        if (seen.has(s)) return false;
        seen.add(s);
      }
      return true;
    };
    if (ok(a) && ok(b)) return k;
  }
  return null;
}

const scalarEq = (x, y) => (x instanceof BigNum || y instanceof BigNum ? String(x) === String(y) : Object.is(x, y) || x === y);

/* Structural diff. Arrays of objects with a unique id/_id/uuid/key are matched
   by that key, so an insertion doesn't mark every later item as changed. */
export function diffJSON(a, b, limit = 2000) {
  const out = [];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const full = () => out.length >= limit;
  const walk = (x, y, path) => {
    if (full()) return;
    const tx = typeOf(x), ty = typeOf(y);
    if (tx !== ty) { out.push({ kind: "changed", path, from: x, to: y }); return; }
    if (tx === "object") {
      for (const k of Object.keys(x)) {
        if (full()) return;
        if (!has(y, k)) out.push({ kind: "removed", path: path.concat(k), from: x[k] });
        else walk(x[k], y[k], path.concat(k));
      }
      for (const k of Object.keys(y)) if (full()) return; else if (!has(x, k)) out.push({ kind: "added", path: path.concat(k), to: y[k] });
    } else if (tx === "array") {
      const idk = idKeyFor(x, y);
      if (idk) {
        const mapY = new Map(y.map((v) => [String(v[idk]), v]));
        const mapX = new Map(x.map((v) => [String(v[idk]), v]));
        for (const v of x) {
          if (full()) return;
          const seg = { key: idk, value: v[idk] instanceof BigNum ? v[idk].raw : v[idk] };
          const w = mapY.get(String(v[idk]));
          if (w === undefined) out.push({ kind: "removed", path: path.concat(seg), from: v });
          else walk(v, w, path.concat(seg));
        }
        for (const v of y) {
          if (full()) return;
          if (!mapX.has(String(v[idk]))) out.push({ kind: "added", path: path.concat({ key: idk, value: v[idk] instanceof BigNum ? v[idk].raw : v[idk] }), to: v });
        }
      } else {
        const n = Math.max(x.length, y.length);
        for (let i = 0; i < n && !full(); i++) {
          if (i >= y.length) out.push({ kind: "removed", path: path.concat(i), from: x[i] });
          else if (i >= x.length) out.push({ kind: "added", path: path.concat(i), to: y[i] });
          else walk(x[i], y[i], path.concat(i));
        }
      }
    } else if (!scalarEq(x, y)) out.push({ kind: "changed", path, from: x, to: y });
  };
  walk(a, b, []);
  return { changes: out, truncated: out.length >= limit };
}

/* ---- Type inference shared by TypeScript and JSON Schema output ---- */
const emptyShape = () => ({ prims: new Set(), obj: null, arr: null });
function addShape(t, v) {
  if (v === null) t.prims.add("null");
  else if (v instanceof BigNum) t.prims.add(/[.eE]/.test(v.raw) ? "number" : "integer");
  else if (typeof v === "number") t.prims.add(Number.isInteger(v) ? "integer" : "number");
  else if (typeof v === "string" || typeof v === "boolean") t.prims.add(typeof v);
  else if (Array.isArray(v)) {
    t.arr ??= { item: null };
    for (const x of v) { t.arr.item ??= emptyShape(); addShape(t.arr.item, x); }
  } else {
    t.obj ??= { fields: new Map(), n: 0 };
    t.obj.n++;
    for (const k of Object.keys(v)) {
      let f = t.obj.fields.get(k);
      if (!f) { f = { t: emptyShape(), count: 0 }; t.obj.fields.set(k, f); }
      f.count++;
      addShape(f.t, v[k]);
    }
  }
}
const shapeOf = (v) => { const t = emptyShape(); addShape(t, v); return t; };

function pascal(s) {
  const p = String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(p) ? `T${p}` : p;
}
function singular(s) {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, "y");
  if (/(ss|us|is)$/i.test(s)) return s;
  return s.replace(/s$/i, "");
}

export function toTypeScript(value, rootName = "Root") {
  const t = shapeOf(value);
  const decls = [];
  const used = new Set();
  const pureObj = t.obj && !t.arr && !t.prims.size;
  if (!pureObj) used.add(rootName);
  const nameFor = (hint) => {
    const base = pascal(hint) || "Item";
    let n = base, k = 2;
    while (used.has(n)) n = base + k++;
    used.add(n);
    return n;
  };
  const safeKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const render = (s, hint) => {
    const parts = [];
    if (s.obj) {
      if (!s.obj.fields.size) parts.push("Record<string, unknown>");
      else {
        const name = nameFor(hint);
        const at = decls.length;
        decls.push("");
        const lines = [...s.obj.fields].map(([k, f]) => `  ${safeKey(k)}${f.count < s.obj.n ? "?" : ""}: ${render(f.t, k)};`);
        decls[at] = `export interface ${name} {\n${lines.join("\n")}\n}`;
        parts.push(name);
      }
    }
    if (s.arr) {
      const inner = s.arr.item ? render(s.arr.item, singular(hint)) : "unknown";
      parts.push(inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`);
    }
    if (s.prims.has("string")) parts.push("string");
    if (s.prims.has("number") || s.prims.has("integer")) parts.push("number");
    if (s.prims.has("boolean")) parts.push("boolean");
    if (s.prims.has("null")) parts.push("null");
    return parts.length ? parts.join(" | ") : "unknown";
  };
  const top = render(t, pureObj ? rootName : `${rootName}Item`);
  if (!pureObj) decls.unshift(`export type ${rootName} = ${top};`);
  return decls.join("\n\n");
}

export function toJSONSchema(value) {
  const conv = (s) => {
    const opts = [];
    if (s.obj) {
      const properties = Object.create(null); // a "__proto__" key must stay a property, not a prototype
      const required = [];
      for (const [k, f] of s.obj.fields) {
        properties[k] = conv(f.t);
        if (f.count === s.obj.n) required.push(k);
      }
      opts.push({ type: "object", properties, ...(required.length ? { required } : {}) });
    }
    if (s.arr) opts.push({ type: "array", items: s.arr.item ? conv(s.arr.item) : {} });
    const prims = ["string", "integer", "number", "boolean", "null"].filter((p) => s.prims.has(p));
    if (prims.includes("number")) prims.splice(prims.indexOf("integer"), prims.includes("integer") ? 1 : 0);
    for (const p of prims) opts.push({ type: p });
    if (!opts.length) return {};
    if (opts.length === 1) return opts[0];
    if (opts.every((o) => Object.keys(o).length === 1)) return { type: opts.map((o) => o.type) };
    return { anyOf: opts };
  };
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...conv(shapeOf(value)) };
}

/* Text like "{\"a\":1}" — a JSON string whose content is itself JSON. */
export function innerJSON(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!/^[[{]/.test(t)) return null;
  const r = parseJSON(t);
  return r.ok && isContainer(r.value) ? r : null;
}
