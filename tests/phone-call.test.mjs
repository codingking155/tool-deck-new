import { test } from "node:test";
import assert from "node:assert/strict";
import { callWindow, diffText } from "../src/lib/phoneCall.js";

test("callWindow buckets the local hour", () => {
  assert.equal(callWindow(10)[0], "good");
  assert.equal(callWindow(8)[0], "warn");
  assert.equal(callWindow(19)[0], "warn");
  assert.equal(callWindow(2)[0], "bad");
  assert.equal(callWindow(21)[0], "bad");
});

test("diffText describes the offset from the viewer", () => {
  assert.equal(diffText(0), "same time as you");
  assert.equal(diffText(330), "5h 30m ahead of you");
  assert.equal(diffText(-60), "1h behind you");
});
