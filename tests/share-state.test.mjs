import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase64Url, fromBase64Url, encodeShare, decodeShare, readHashParam, shareUrl, shareBase, makeShareLink, readStored, writeStored } from "../src/lib/shareState.js";

test("base64url round-trips bytes without +, / or padding", () => {
  const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 255);
  const s = toBase64Url(bytes);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(fromBase64Url(s), bytes);
  assert.deepEqual(fromBase64Url(toBase64Url(new Uint8Array([251, 255]))), new Uint8Array([251, 255]));
  assert.throws(() => fromBase64Url("ab+c"), /base64url/);
});

test("encodeShare/decodeShare round-trip unicode, compressed and plain", async () => {
  const text = JSON.stringify({ name: "Asha Rao ₹ 🍵", items: Array.from({ length: 40 }, (_, i) => ({ id: i, sku: "TEA-500" })) });
  const z = await encodeShare(text);
  assert.equal(z[0], "z", "repetitive JSON compresses");
  assert.ok(z.length < text.length);
  assert.equal(await decodeShare(z), text);
  const b = await encodeShare(text, { compress: false });
  assert.equal(b[0], "b");
  assert.equal(await decodeShare(b), text);
  assert.equal(await decodeShare(await encodeShare("")), "");
});

test("encodeShare keeps plain base64 when compression doesn't help", async () => {
  const p = await encodeShare("ab");
  assert.equal(p[0], "b");
  assert.equal(await decodeShare(p), "ab");
});

test("decodeShare rejects junk, unknown kinds and oversized payloads", async () => {
  await assert.rejects(decodeShare("q123"), /Unrecognised/);
  await assert.rejects(decodeShare("b%%%"), /base64url/);
  await assert.rejects(decodeShare("zAAAA"));
  const big = await encodeShare("x".repeat(100000));
  assert.equal(big[0], "z");
  await assert.rejects(decodeShare(big, { maxBytes: 1000 }), /too large/);
  await assert.rejects(decodeShare(await encodeShare("y".repeat(50), { compress: false }), { maxBytes: 10 }), /too large/);
});

test("readHashParam ignores route hashes and finds the key", () => {
  assert.equal(readHashParam("#j=zabc", "j"), "zabc");
  assert.equal(readHashParam("p=b1&j=z2", "j"), "z2");
  assert.equal(readHashParam("#/tool/json", "j"), null);
  assert.equal(readHashParam("", "j"), null);
  assert.equal(readHashParam("#j=", "j"), null);
  assert.equal(readHashParam("#jj=x", "j"), null);
});

test("shareUrl replaces any existing hash", () => {
  assert.equal(shareUrl("https://x.dev/tool/json?a=1#old", "j", "zQ"), "https://x.dev/tool/json?a=1#j=zQ");
});

test("shareBase keeps path + query, and turns legacy hash routes into paths", () => {
  assert.equal(shareBase(new URL("https://x.dev/tool/json?a=1#j=zz")), "https://x.dev/tool/json?a=1");
  assert.equal(shareBase(new URL("https://x.dev/#/tool/prompt")), "https://x.dev/tool/prompt");
});

test("readStored/writeStored never fall back to localStorage when given null storage", () => {
  assert.equal(readStored("k", null), null);
  assert.equal(writeStored("k", 1, null), false);
});

test("makeShareLink flags payloads over the limit and round-trips through the hash", async () => {
  const small = await makeShareLink("https://x.dev/tool/json", "j", '{"a":1}', { maxPayload: 4096 });
  assert.equal(small.ok, true);
  assert.equal(await decodeShare(readHashParam(new URL(small.url).hash, "j")), '{"a":1}');
  const noisy = Array.from({ length: 6000 }, (_, i) => ((i * 7919) % 9973).toString(36)).join(",");
  const big = await makeShareLink("https://x.dev/", "j", noisy, { maxPayload: 4096 });
  assert.equal(big.ok, false);
  assert.ok(big.payloadLength > 4096);
});

test("readStored/writeStored survive missing, broken and throwing storage", () => {
  const mem = new Map();
  const s = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(writeStored("k", { a: 1 }, s), true);
  assert.deepEqual(readStored("k", s), { a: 1 });
  writeStored("k", null, s);
  assert.equal(readStored("k", s), null);
  mem.set("bad", "{nope");
  assert.equal(readStored("bad", s), null);
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.equal(readStored("k", boom), null);
  assert.equal(writeStored("k", 1, boom), false);
});
