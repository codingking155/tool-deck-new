/* Pure JSON helpers — no DOM, so tests/json-core.test.mjs can import them. */

export function lineCol(text, pos) {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return { line, col: pos - before.lastIndexOf("\n") };
}

/* Engines word (or omit) error positions differently, so locate the first
   error ourselves with a minimal scanner. Only runs after JSON.parse fails. */
function locateError(s) {
  let i = 0;
  const fail = (msg) => { throw { pos: i, msg }; };
  const ws = () => { while (i < s.length && " \t\n\r".includes(s[i])) i++; };
  const show = () => (i >= s.length ? "end of input" : `"${s[i]}"`);
  const value = () => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++; ws();
      if (s[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(s[i] === "'" ? "Keys need double quotes, not single quotes" : s[i] === "}" ? "Trailing comma before }" : `Expected a "quoted" key but found ${show()}`);
        str(); ws();
        if (s[i] !== ":") fail(`Expected ":" after the key but found ${show()}`);
        i++; value(); ws();
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
        value(); ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return; }
        fail(`Expected "," or "]" but found ${show()} — missing comma?`);
      }
    }
    if (c === '"') return str();
    if (c === "'") fail("Strings need double quotes, not single quotes");
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = s.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
      if (!m) fail("Invalid number");
      i += m[0].length; return;
    }
    for (const lit of ["true", "false", "null"]) if (s.startsWith(lit, i)) { i += lit.length; return; }
    fail(i >= s.length ? "Unexpected end of input — something isn't closed" : `Unexpected ${show()}`);
  };
  const str = () => {
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\") {
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

export function parseJSON(text) {
  if (!text.trim()) return { ok: false, empty: true, error: { message: "Paste some JSON to start." } };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const loc = locateError(text);
    if (!loc) return { ok: false, error: { message: String(e.message || e) } };
    return { ok: false, error: { message: loc.msg, pos: loc.pos, ...lineCol(text, loc.pos) } };
  }
}

export function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeysDeep(v[k]); return o; }, {});
  }
  return v;
}

export function formatJSON(value, indent = 2, sortKeys = false) {
  return JSON.stringify(sortKeys ? sortKeysDeep(value) : value, null, indent === "tab" ? "\t" : Number(indent));
}

export function minifyJSON(value, sortKeys = false) {
  return JSON.stringify(sortKeys ? sortKeysDeep(value) : value);
}

const YAML_PLAIN = /^[A-Za-z_][A-Za-z0-9_ .\/-]*$/;
const YAML_RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
function yamlScalar(v) {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (s && YAML_PLAIN.test(s) && !YAML_RESERVED.test(s) && s.trim() === s) return s;
  return JSON.stringify(s);
}
function yamlKey(k) { return YAML_PLAIN.test(k) && !YAML_RESERVED.test(k) ? k : JSON.stringify(k); }

export function toYAML(v, ind = 0) {
  const pad = "  ".repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((item) => {
      if (item && typeof item === "object" && Object.keys(item).length) {
        const inner = toYAML(item, ind + 1);
        return `${pad}- ${inner.slice(pad.length + 2)}`;
      }
      return `${pad}- ${item && typeof item === "object" ? (Array.isArray(item) ? "[]" : "{}") : yamlScalar(item)}`;
    }).join("\n");
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return keys.map((k) => {
      const c = v[k];
      if (c && typeof c === "object" && (Array.isArray(c) ? c.length : Object.keys(c).length)) {
        return `${pad}${yamlKey(k)}:\n${toYAML(c, ind + 1)}`;
      }
      return `${pad}${yamlKey(k)}: ${c && typeof c === "object" ? (Array.isArray(c) ? "[]" : "{}") : yamlScalar(c)}`;
    }).join("\n");
  }
  return yamlScalar(v);
}

/* Array of objects → CSV; columns are the union of all keys in first-seen order. */
export function toCSV(v) {
  if (!Array.isArray(v) || !v.length || !v.every((r) => r && typeof r === "object" && !Array.isArray(r))) return null;
  const cols = [];
  for (const r of v) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (x) => {
    if (x === undefined || x === null) return "";
    const s = typeof x === "object" ? JSON.stringify(x) : String(x);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(cell).join(","), ...v.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

/* Supports $, .key, ['key'], ["key"], [0], [-1] and [*]. Returns { ok, matches } or { ok:false, error }. */
export function queryPath(root, path) {
  const p = path.trim();
  if (!p.startsWith("$")) return { ok: false, error: "Path must start with $" };
  const tokens = [];
  const re = /\.([A-Za-z_$][\w$-]*)|\.\*|\[(-?\d+)\]|\[\*\]|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]/y;
  let i = 1;
  while (i < p.length) {
    re.lastIndex = i;
    const m = re.exec(p);
    if (!m) return { ok: false, error: `Can't read the path at "${p.slice(i)}"` };
    if (m[1] !== undefined) tokens.push({ key: m[1] });
    else if (m[2] !== undefined) tokens.push({ index: Number(m[2]) });
    else if (m[3] !== undefined) tokens.push({ key: m[3] });
    else if (m[4] !== undefined) tokens.push({ key: m[4] });
    else tokens.push({ wild: true });
    i = re.lastIndex;
  }
  let cur = [root];
  for (const t of tokens) {
    const next = [];
    for (const n of cur) {
      if (n === null || typeof n !== "object") continue;
      if (t.wild) next.push(...(Array.isArray(n) ? n : Object.values(n)));
      else if (t.index !== undefined) {
        if (Array.isArray(n)) { const v = n[t.index < 0 ? n.length + t.index : t.index]; if (v !== undefined) next.push(v); }
      } else if (Object.prototype.hasOwnProperty.call(n, t.key)) next.push(n[t.key]);
    }
    cur = next;
  }
  return { ok: true, matches: cur };
}

export function stats(value, text) {
  let keys = 0, depth = 0;
  const walk = (v, d) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) { keys++; walk(v[k], d + 1); }
  };
  walk(value, 0);
  return { keys, depth, bytes: new TextEncoder().encode(text).length };
}
