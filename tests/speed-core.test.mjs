import { test } from "node:test";
import assert from "node:assert/strict";
import { median, cleanSamples, jitterOf, mbps, windowMbps, finalMbps, summaryText, historyCsv, compareRuns, parseCfL4, aggregateLoss, isStable, consistencyOf, bufferbloatGrade, healthScore, activityGrades, classifyIp, parseClient, diagnose, gaugeAngle, migrateHistory, maskIp, HISTORY_VERSION } from "../src/lib/speedCore.mjs";

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
  assert.match(txt, /Packet loss: Not supported by this measurement provider/);
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

/* ── Phase 1 diagnostics core ───────────────────────────────────────── */

test("consistencyOf: steady line scores high, choppy line scores low", () => {
  const steady = consistencyOf([100, 98, 102, 99, 101, 100]);
  assert.ok(steady.score >= 95);
  assert.equal(steady.majorDrops, 0);
  const choppy = consistencyOf([100, 20, 90, 15, 95, 10, 100, 25]);
  assert.ok(choppy.score < steady.score);
  assert.ok(choppy.majorDrops >= 3);
  assert.equal(consistencyOf([1, 2]), null); // too few samples to be honest
});

test("bufferbloatGrade: deterministic thresholds and direction-aware text", () => {
  assert.equal(bufferbloatGrade(10, 20, 15).grade, "A+");
  assert.equal(bufferbloatGrade(10, 45, 30).grade, "A");
  assert.equal(bufferbloatGrade(10, 100, 30).grade, "B");
  assert.equal(bufferbloatGrade(10, 30, 200).grade, "C");
  assert.equal(bufferbloatGrade(10, 30, 300).grade, "D");
  assert.equal(bufferbloatGrade(10, 600, 30).grade, "F");
  assert.match(bufferbloatGrade(10, 30, 400).explanation, /uploading/);
  assert.equal(bufferbloatGrade(null, 100, 100), null);
});

test("healthScore: speed cannot buy an excellent score on an unstable line", () => {
  const fastStable = healthScore({ down: 300, up: 100, ping: 10, bufferbloatWorst: 10, jitter: 2, lossPct: 0, consistencyScore: 95 });
  assert.ok(fastStable.score >= 90);
  const fastUnstable = healthScore({ down: 300, up: 100, ping: 10, bufferbloatWorst: 480, jitter: 45, lossPct: 2, consistencyScore: 10 });
  assert.ok(fastUnstable.score <= 70, `unstable must not score excellent, got ${fastUnstable.score}`);
});

test("healthScore: missing metrics reweight and lower confidence, never count as failure", () => {
  const partial = healthScore({ down: 100, up: 40, ping: 15 });
  assert.ok(partial.score >= 70, "absent loss/consistency must not drag the score down");
  assert.ok(partial.confidence < 1);
  assert.equal(healthScore({}), null);
});

test("activityGrades: gaming judged on latency, backup on upload", () => {
  const slowButSnappy = Object.fromEntries(activityGrades({ down: 12, up: 2, ping: 15, jitter: 3, lossPct: 0, consistencyScore: 90, bufferbloatWorst: 20 }).map(r => [r.label, r.status]));
  assert.equal(slowButSnappy["Online gaming"], "good");
  assert.equal(slowButSnappy["4K streaming"], "poor");
  assert.equal(slowButSnappy["Cloud backup"], "poor");
  const fatButLaggy = Object.fromEntries(activityGrades({ down: 400, up: 100, ping: 180, jitter: 40, lossPct: 2, consistencyScore: 90, bufferbloatWorst: 300 }).map(r => [r.label, r.status]));
  assert.equal(fatButLaggy["Online gaming"], "poor");
  assert.equal(fatButLaggy["Large downloads"], "good");
});

test("classifyIp: honest states, never a definitive static claim", () => {
  assert.equal(classifyIp(null).state, "Unknown");
  assert.equal(classifyIp("1.2.3.4", []).state, "Cannot be determined automatically");
  assert.equal(classifyIp("1.2.3.4", [{ ip: "1.2.3.4", iso: "2026-07-26T00:00:00Z" }]).state, "Cannot be determined automatically");
  const changed = classifyIp("1.2.3.5", [{ ip: "1.2.3.5", iso: "2026-07-26T00:00:00Z" }, { ip: "1.2.3.4", iso: "2026-07-20T00:00:00Z" }]);
  assert.equal(changed.state, "Dynamic (observed)");
  const stableWeek = classifyIp("1.2.3.4", [{ ip: "1.2.3.4", iso: "2026-07-26T00:00:00Z" }, { ip: "1.2.3.4", iso: "2026-07-10T00:00:00Z" }]);
  assert.equal(stableWeek.state, "Possibly static");
  assert.match(stableWeek.detail, /only your ISP can confirm/i);
  const stableDay = classifyIp("1.2.3.4", [{ ip: "1.2.3.4", iso: "2026-07-26T10:00:00Z" }, { ip: "1.2.3.4", iso: "2026-07-26T01:00:00Z" }]);
  assert.equal(stableDay.state, "Likely dynamic");
});

test("parseClient: client hints beat UA, sensible fallbacks", () => {
  const ch = parseClient({ uaData: { brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }], platform: "Windows", mobile: false, uaFullVersion: "126.0.1.2" }, ua: "Mozilla/5.0 Chrome/126.0" });
  assert.deepEqual([ch.browser, ch.os, ch.device, ch.version], ["Chrome", "Windows", "Windows desktop", "126"]);
  const ff = parseClient({ ua: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0" });
  assert.deepEqual([ff.browser, ff.os, ff.device], ["Firefox", "Linux", "Linux desktop"]);
  const saf = parseClient({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1" });
  assert.deepEqual([saf.browser, saf.device], ["Safari", "iPhone"]);
  const ipad = parseClient({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15", platform: "MacIntel", touchPoints: 5 });
  assert.equal(ipad.device, "Tablet");
});

test("diagnose: every recommendation is tied to observed evidence", () => {
  const clean = diagnose({ down: 100, up: 40, ping: 12, lossPct: 0, bufferbloat: { grade: "A+", worst: 5 }, consistency: { score: 95, variationPct: 4, majorDrops: 0 } });
  assert.match(clean.lines[0], /fast and stable/);
  assert.equal(clean.recs.length, 0);
  const bloated = diagnose({ down: 100, up: 40, ping: 12, lossPct: 0, bufferbloat: { grade: "D", worst: 400, addedUp: 400, addedDown: 20 }, consistency: { score: 90, variationPct: 8, majorDrops: 0 } });
  assert.match(bloated.lines.join(" "), /under load/);
  assert.match(bloated.recs.join(" "), /SQM|backups/);
  const slowVsHistory = diagnose({ down: 30, up: 10, ping: 20, lossPct: 0 }, 60);
  assert.match(slowVsHistory.lines.join(" "), /50% below your recent median/);
});

test("gaugeAngle: log-scaled, clamped, monotonic", () => {
  assert.equal(gaugeAngle(0), 0);
  assert.equal(gaugeAngle(1000, 1000), 240);
  assert.ok(gaugeAngle(10) < gaugeAngle(100));
  const mid = gaugeAngle(10, 1000);   // 0.1→1000 log-range: 10 is halfway
  assert.ok(Math.abs(mid - 120) < 1, `expected ~120°, got ${mid}`);
  assert.equal(gaugeAngle(99999, 1000), 240);
});

test("history migration: v2 rows become v3 without losing data", () => {
  const v2 = [{ iso: "2026-07-20T10:00:00Z", when: "20 Jul", down: 88.1, up: 30.2, ping: 12, jitter: 2, loadedDown: 40, loadedUp: 90, loss: 0.2, server: "Cloudflare edge", serverId: "cf", dataUsed: 180 }];
  const out = migrateHistory(v2);
  assert.equal(out[0].v, HISTORY_VERSION);
  assert.equal(out[0].lossPct, 0.2);
  assert.equal(out[0].provider, "Cloudflare edge");
  assert.equal(out[0].down, 88.1);
  assert.equal(migrateHistory(out)[0], out[0]); // idempotent
  assert.deepEqual(migrateHistory(null), []);
});

test("maskIp keeps only network prefix for both families", () => {
  assert.equal(maskIp("103.186.40.202"), "103.186.40.x");
  assert.equal(maskIp("2401:4900:1c5b:aa::1"), "2401:4900:1c5b::…");
  assert.equal(maskIp(null), null);
});
