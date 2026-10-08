/* Client-side share links + draft persistence. Pure (no DOM), so it runs under node --test.
   Share payloads live in the URL hash (never sent to a server): "z" + base64url(deflate-raw)
   when CompressionStream exists, else "b" + base64url(utf-8). */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("Not base64url");
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/* Reads a stream into one buffer, refusing to grow past `max` bytes (zip-bomb guard). */
async function drain(stream, max) {
  const reader = stream.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel().catch(() => {}); throw new Error("Shared data is too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const pipe = (bytes, Transform, max) => drain(new Blob([bytes]).stream().pipeThrough(new Transform("deflate-raw")), max);

/** Text -> URL-safe payload. Compresses when the runtime can and it actually helps. */
export async function encodeShare(text, { compress = true } = {}) {
  const raw = enc.encode(text);
  const plain = "b" + toBase64Url(raw);
  if (!compress || typeof CompressionStream === "undefined") return plain;
  try {
    const z = "z" + toBase64Url(await pipe(raw, CompressionStream, Infinity));
    return z.length < plain.length ? z : plain;
  } catch { return plain; }
}

/** Payload -> text. Throws on malformed input, unsupported compression or > maxBytes decoded. */
export async function decodeShare(payload, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const kind = payload[0], body = payload.slice(1);
  if (kind === "b") {
    const bytes = fromBase64Url(body);
    if (bytes.length > maxBytes) throw new Error("Shared data is too large");
    return dec.decode(bytes);
  }
  if (kind === "z") {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open compressed links");
    return dec.decode(await pipe(fromBase64Url(body), DecompressionStream, maxBytes));
  }
  throw new Error("Unrecognised share link");
}

/** The payload for `key` in a hash like "#j=…" (or "j=…"), or null. Route hashes ("#/tool/x") never match. */
export function readHashParam(hash, key) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h || h.startsWith("/")) return null;
  for (const part of h.split("&")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === key) return part.slice(i + 1) || null;
  }
  return null;
}

/** Page URL to share from `location`; a legacy "#/tool/x" route becomes its path so the share hash can't clobber it. */
export function shareBase(loc) {
  const h = loc.hash || "";
  return h.startsWith("#/") ? loc.origin + h.slice(1) : loc.origin + loc.pathname + loc.search;
}

/** Full share URL: base (origin + path + search, no hash) + "#key=payload". */
export const shareUrl = (base, key, payload) => `${String(base).split("#")[0]}#${key}=${payload}`;

/** Encodes `text` into a share URL. ok=false (url still built) when the payload exceeds maxPayload chars. */
export async function makeShareLink(base, key, text, { maxPayload = Infinity } = {}) {
  const payload = await encodeShare(text);
  return { ok: payload.length <= maxPayload, url: shareUrl(base, key, payload), payloadLength: payload.length };
}

/* Storage that may be missing, full or blocked (private mode): every access is guarded. */
export function readStored(key, storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    const raw = s?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function writeStored(key, value, storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    if (!s) return false;
    if (value == null) s.removeItem(key); else s.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
