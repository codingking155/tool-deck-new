import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, addRecent, loadRecent, saveRecent } from "../src/lib/recentChecks.js";

test("hostOf normalises URLs, strips www, rejects junk", () => {
  assert.equal(hostOf("https://www.Example.com/path?q=1"), "example.com");
  assert.equal(hostOf("store.example.in"), "store.example.in");
  assert.equal(hostOf("  http://a.b.co:8080 "), "a.b.co");
  assert.equal(hostOf(""), null); assert.equal(hostOf(null), null); assert.equal(hostOf("not a url"), null);
});

test("addRecent: newest first, de-duplicated by host, capped, ignores empty", () => {
  let l = [];
  l = addRecent(l, { host: "a.com", label: "Shopify", at: 1 });
  l = addRecent(l, { host: "b.com", label: "Not Shopify", at: 2 });
  l = addRecent(l, { host: "a.com", label: "Shopify store", at: 3 });
  assert.deepEqual(l.map((e) => e.host), ["a.com", "b.com"]);
  assert.equal(l[0].label, "Shopify store");
  assert.equal(addRecent(l, { host: "" }), l);
  for (let i = 0; i < 20; i++) l = addRecent(l, { host: `s${i}.com` }, 8);
  assert.equal(l.length, 8); assert.equal(l[0].host, "s19.com");
});

test("load/save round-trip and tolerate corrupt or unavailable storage", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveRecent("k", [{ host: "a.com", label: "x", at: 1 }]);
  assert.deepEqual(loadRecent("k"), [{ host: "a.com", label: "x", at: 1 }]);
  store.set("k", "{not json"); assert.deepEqual(loadRecent("k"), []);
  store.set("k", JSON.stringify([{ nohost: 1 }, { host: "ok.com" }])); assert.deepEqual(loadRecent("k").map((e) => e.host), ["ok.com"]);
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadRecent("k"), []); saveRecent("k", []);
  delete globalThis.localStorage;
});
