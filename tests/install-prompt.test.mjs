import test from "node:test";
import assert from "node:assert/strict";
import { decideOffer, wasOffered, markOffered, isIOSDevice, isStandalone, OFFER_KEY, LEGACY_KEY } from "../src/lib/installPrompt.js";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test("decideOffer: native dialog, iOS manual steps, and every reason not to show", () => {
  assert.equal(decideOffer({ hasNativePrompt: true }), "native");
  assert.equal(decideOffer({ isIOS: true }), "ios");
  assert.equal(decideOffer({ hasNativePrompt: true, isIOS: true }), "native");
  assert.equal(decideOffer({}), null);                                                  // desktop Firefox/Safari: nothing to offer
  assert.equal(decideOffer({ offered: true, hasNativePrompt: true }), null);            // once only
  assert.equal(decideOffer({ installed: true, isIOS: true }), null);                    // already installed
});

test("one-time: marking offered makes wasOffered true; legacy dismissal also counts", () => {
  const s = mem();
  assert.equal(wasOffered(s), false);
  assert.equal(markOffered(s, 123), true);
  assert.equal(s.m.get(OFFER_KEY), "123");
  assert.equal(wasOffered(s), true);
  const old = mem(); old.setItem(LEGACY_KEY, "1700000000000");
  assert.equal(wasOffered(old), true);
});

test("broken or missing storage never throws", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(wasOffered(throwing), false);
  assert.equal(markOffered(throwing), false);
  assert.equal(wasOffered(null), false);
  assert.equal(markOffered(undefined), false);
});

test("platform detection", () => {
  assert.equal(isIOSDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(isIOSDevice("Mozilla/5.0 (Linux; Android 14)"), false);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(isStandalone(undefined), false);
});
