import { test } from "node:test";
import assert from "node:assert/strict";
import { fitScale, clampPan, zoomAt, stepZoom, savingPct, wrapIndex, MAX_ZOOM } from "../src/lib/viewerMath.mjs";

test("fitScale fits, never upscales, respects rotation", () => {
  assert.equal(fitScale(2000, 1000, 1000, 1000), 0.5);
  assert.equal(fitScale(100, 100, 1000, 1000), 1);
  assert.equal(fitScale(2000, 1000, 1000, 1000, 90), 0.5);
  assert.equal(fitScale(1000, 2000, 1000, 500, 90), 0.5);
  assert.equal(fitScale(0, 10, 10, 10), 1);
});

test("zoomAt keeps the point under the cursor fixed", () => {
  const { scale, pan } = zoomAt(1, { x: 0, y: 0 }, 2, 100, 50);
  assert.equal(scale, 2);
  // image point under cursor before: (100-0)/1 = 100 ; after: (100 - pan.x)/2 must be 100
  assert.equal((100 - pan.x) / 2, 100);
  assert.equal((50 - pan.y) / 2, 50);
  assert.equal(zoomAt(1, { x: 0, y: 0 }, 999).scale, MAX_ZOOM);
});

test("clampPan centres when image fits and bounds when larger", () => {
  assert.deepEqual(clampPan({ x: 40, y: -40 }, 100, 100, 1, 500, 500), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 999, y: -999 }, 1000, 600, 1, 500, 500), { x: 250, y: -50 });
});

test("stepZoom, savingPct, wrapIndex", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1.25, -1), 1);
  assert.equal(savingPct(1000, 250), 75);
  assert.equal(savingPct(0, 5), 0);
  assert.equal(wrapIndex(-1, 8), 7);
  assert.equal(wrapIndex(8, 8), 0);
});
