import { test } from "node:test";
import assert from "node:assert/strict";
import { median, cleanSamples, jitterOf, mbps, windowMbps, finalMbps, summaryText, historyCsv, compareRuns, parseCfL4, aggregateLoss, isStable } from "../src/lib/speedCore.mjs";

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

test("finalMbps stays accurate with few, large samples (upload's multi-MB chunks)", () => {
  // A constant-rate transfer split into few large chunks (as upload sends whole
  // payloads per fetch, unlike download's many small stream reads) used to
  // overstate the rate: crediting a sample's bytes to a window starting at its
  // own timestamp shrinks the apparent duration for that chunk.
  const trueMbps = 8;
  const bytesPerMs = (trueMbps * 1e6) / 8 / 1000;
  let t = 0;
  const samples = [{ t: 0, bytes: 0 }];
  for (const bytes of [2e6, 8e6, 8e6, 16e6, 16e6, 16e6, 16e6, 16e6]) {
    t += bytes / bytesPerMs;
    samples.push({ t, bytes });
  }
  const v = finalMbps(samples);
  assert.ok(Math.abs(v - trueMbps) < 0.05, `expected ~${trueMbps}, got ${v}`);
});

test("summary text never fabricates: nulls become dashes, loss labelled honestly", () => {
  const txt = summaryText({ when: "2026-07-24 10:00", down: 92.4, up: null, ping: 12, jitter: 2, loadedDown: 40, loadedUp: null, loss: null, server: "Cloudflare · BLR" });
  assert.match(txt, /↑ —/);
  assert.match(txt, /Packet loss: Unavailable over HTTP/);
  const txt2 = summaryText({ when: "x", down: 1, up: 1, ping: 1, jitter: 1, loadedDown: 1, loadedUp: 1, loss: 0.34, server: "s" });
  assert.match(txt2, /Packet loss: 0.34%/);
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

test("parseCfL4 extracts TCP counters from a real Server-Timing value", () => {
  const h = 'cfSpeedEdge;dur=3, cfL4;desc="?proto=TCP&rtt=10280&min_rtt=10182&rtt_var=2940&sent=140&recv=6&lost=1&retrans=2&sent_bytes=3014&recv_bytes=510&delivery_rate=276566&cwnd=53&unsent_bytes=0&cid=b7612a6d37310938&ts=49&x=0"';
  const r = parseCfL4(h);
  assert.equal(r.sent, 140);
  assert.equal(r.lost, 1);
  assert.equal(r.retrans, 2);
  assert.equal(r.cid, "b7612a6d37310938");
  assert.ok(Math.abs(r.rttMs - 10.28) < 0.01);
  assert.equal(parseCfL4(null), null);
  assert.equal(parseCfL4("cfSpeedEdge;dur=3"), null);
  assert.equal(parseCfL4('cfL4;desc="?proto=TCP&cid=x"'), null);
});

test("aggregateLoss keeps only the last cumulative reading per connection", () => {
  const r = aggregateLoss([
    { cid: "a", sent: 100, lost: 0, retrans: 1 },
    { cid: "a", sent: 900, lost: 2, retrans: 7 },   // supersedes the first
    { cid: "b", sent: 100, lost: 0, retrans: 0 },
  ]);
  assert.equal(r.sent, 1000);
  assert.equal(r.pct, 0.9);                          // (2+7+0)/1000
  assert.equal(aggregateLoss([]), null);
  assert.equal(aggregateLoss([{ cid: "a", sent: 0, lost: 0, retrans: 0 }]), null);
});

test("isStable fires only on flat throughput after enough samples", () => {
  assert.equal(isStable([100, 100, 100], 5), false);            // too few
  assert.equal(isStable([50, 98, 100, 101, 99, 100], 5, 0.05), true);
  assert.equal(isStable([50, 60, 100, 101, 99, 100], 5, 0.05), false); // 60 in tail
  assert.equal(isStable([0, 0, 0, 0, 0], 5), false);            // no signal yet
});

/* ── upload engine against a simulated link ─────────────────────────────── */
import { runUpload } from "../src/lib/speed.js";

// A link of `mbps` shared by however many POSTs are in flight; each request
// resolves when its body would have finished, and honours abort signals.
function simulatedUplink(mbps) {
  let active = 0;
  return async (_url, { body, signal }) => {
    active++;
    const ms = (body.length * 8) / ((mbps * 1e6) / active) * 1000;
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
      });
    } finally { active--; }
    return new Response("{}", { status: 200 });
  };
}

test("upload: a slow uplink finishes near maxMs and reports a real rate", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = simulatedUplink(2);          // 2 Mbps, shared by 4 streams
  try {
    const t0 = performance.now();
    const r = await runUpload({ up: "https://example.test/up" }, { minMs: 800, maxMs: 1500 });
    const took = performance.now() - t0;
    assert.ok(took < 1500 + 3000, `upload phase ran ${Math.round(took)} ms`);
    assert.ok(r.mbps != null && r.mbps > 1 && r.mbps < 3, `measured ${r.mbps} Mbps on a 2 Mbps link`);
  } finally { globalThis.fetch = realFetch; }
});

test("upload: a fast uplink grows the chunk size", async () => {
  const realFetch = globalThis.fetch;
  const sizes = [];
  const link = simulatedUplink(200);
  globalThis.fetch = (u, init) => { sizes.push(init.body.length); return link(u, init); };
  try {
    const r = await runUpload({ up: "https://example.test/up" }, { minMs: 800, maxMs: 1500 });
    assert.ok(Math.max(...sizes) >= 2e6, `largest chunk ${Math.max(...sizes)}`);
    assert.ok(r.mbps > 120 && r.mbps < 260, `measured ${r.mbps} Mbps on a 200 Mbps link`);
  } finally { globalThis.fetch = realFetch; }
});

test("data budget: unused reservations are refunded", async () => {
  const { makeBudget } = await import("../src/lib/speed.js");
  const b = makeBudget(100);
  assert.equal(b.take(60), true);
  assert.equal(b.take(60), false);       // would exceed the budget
  b.refund(50);                          // 50 of the 60 were never transferred
  assert.equal(b.used, 10);
  assert.equal(b.take(60), true);
  b.refund(-5);                          // never goes negative or grows
  assert.equal(b.used, 70);
});

test("download: hitting the budget ends one stream, not all of them", async () => {
  const { runDownload, makeBudget } = await import("../src/lib/speed.js");
  const realFetch = globalThis.fetch;
  let dataCalls = 0;
  globalThis.fetch = async (url) => {
    const n = +/bytes=(\d+)/.exec(url)[1];
    if (n > 0) dataCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(new Uint8Array(Math.min(n, 2e5)), { status: 200 });
  };
  try {
    const budget = makeBudget(60e6);   // exactly the first round of six 10 MB reservations
    const r = await runDownload({ down: (b) => `https://example.test/__down?bytes=${b}` }, { budget, minMs: 600, maxMs: 1200 });
    assert.ok(dataCalls > 12, `only ${dataCalls} download requests — streams stopped early`);
    assert.ok(r.mbps > 0);
    assert.ok(budget.used <= 60e6);
  } finally { globalThis.fetch = realFetch; }
});
