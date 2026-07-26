import { test } from "node:test";
import assert from "node:assert/strict";
import { median, cleanSamples, jitterOf, mbps, windowMbps, finalMbps, summaryText, historyCsv, compareRuns } from "../src/lib/speedCore.mjs";

test("median: odd, even, empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("cleanSamples drops failures and MAD outliers, keeps small sets intact", () => {
  assert.deepEqual(cleanSamples([10, null, NaN, -5, 12]), [10, 12]);
  const cleaned = cleanSamples([20, 21, 19, 22, 20, 21, 400]); // 400 = stray timeout
  assert.ok(!cleaned.includes(400));
  assert.equal(cleaned.length, 6);
});

test("jitter is mean successive difference, not stddev", () => {
  assert.equal(jitterOf([10, 20, 10, 20]), 10);
  assert.equal(jitterOf([15]), null);
});

test("mbps: 1 MB in 1 s = 8 Mbps; guards zero duration", () => {
  assert.equal(mbps(1e6, 1000), 8);
  assert.equal(mbps(1e6, 0), 0);
});

test("windowMbps uses only the trailing window", () => {
  const s = [
    { t: 0, bytes: 0 }, { t: 1000, bytes: 125000 },      // slow first second (1 Mbps)
    { t: 2000, bytes: 1250000 }, { t: 3000, bytes: 1250000 }, // then 10 Mbps
  ];
  const w = windowMbps(s, 2000);
  assert.ok(Math.abs(w - 10) < 0.01, `expected ~10, got ${w}`);
});

test("finalMbps excludes the warm-up fraction", () => {
  const s = [{ t: 0, bytes: 0 }];
  for (let t = 100; t <= 1000; t += 100) s.push({ t, bytes: 12500 });   // 1 Mbps ramp
  for (let t = 1100; t <= 10000; t += 100) s.push({ t, bytes: 125000 }); // 10 Mbps steady
  const v = finalMbps(s, 0.1);
  assert.ok(v > 9.5, `warm-up should be excluded; got ${v}`);
});

test("summary text never fabricates: nulls become dashes, loss labelled honestly", () => {
  const txt = summaryText({ when: "2026-07-24 10:00", down: 92.4, up: null, ping: 12, jitter: 2, loadedDown: 40, loadedUp: null, loss: null, server: "Cloudflare · BLR" });
  assert.match(txt, /↑ —/);
  assert.match(txt, /Packet loss: Unavailable over HTTP/);
  assert.match(txt, /Server: Cloudflare · BLR/);
});

test("history CSV escapes commas and quotes", () => {
  const csv = historyCsv([{ when: "2026-07-24", server: 'My "fast", server', down: 1, up: 2, ping: 3, jitter: 4, loadedDown: 5, loadedUp: 6 }]);
  assert.match(csv, /"My ""fast"", server"/);
  assert.equal(csv.split("\n").length, 2);
});

test("compareRuns yields signed deltas and handles missing previous", () => {
  assert.equal(compareRuns({ down: 100 }, null), null);
  const d = compareRuns({ down: 110.4, up: 20, ping: 12 }, { down: 100, up: 25, ping: 18 });
  assert.deepEqual(d, { down: 10.4, up: -5, ping: -6 });
});
