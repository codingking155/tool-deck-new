import test from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, nextSendUtc, buildOrderRows, fmtDurDays, fmtUtc, fmtUtcDate } from "../src/lib/time.js";

const TZ = "America/Mexico_City"; // GMT-6 in July 2026 (no DST)

test("matches the reference screenshot: Mexico City, order 18:00 Sat 11 Jul, send 08:00 on 13 Jul", () => {
  const order = zonedToUtc("2026-07-11", "18:00", TZ);
  assert.equal(fmtUtc(order) + " " + fmtUtcDate(order), "00:00 12 Jul 2026");
  const send = nextSendUtc(order, "2026-07-11", "08:00", TZ, "2026-07-13");
  assert.equal(fmtUtc(send) + " " + fmtUtcDate(send), "14:00 13 Jul 2026");
  assert.equal(fmtDurDays(send - order), "1 day 14 hr 0 min");
});

test("hourly rows: first is the order time, 2nd row is one hour later with 1 day 13 hr wait", () => {
  const rows = buildOrderRows("2026-07-11", "18:00", "08:00", TZ, "2026-07-13");
  assert.equal(rows.length, 24);
  assert.deepEqual([rows[0].local12, rows[0].local24, rows[0].offset, rows[0].utcOrder, rows[0].targetUtc], ["06:00 PM", "18:00", "GMT-6", "00:00", "14:00"]);
  assert.deepEqual([rows[1].local24, rows[1].utcOrder, rows[1].wait], ["19:00", "01:00", "1 day 13 hr 0 min"]);
});

test("no fixed date: next 08:00 after the order, rolling to the next day when already past", () => {
  const before = zonedToUtc("2026-07-11", "07:00", TZ);
  assert.equal(nextSendUtc(before, "2026-07-11", "08:00", TZ) - before, 3600000);
  const after = zonedToUtc("2026-07-11", "09:00", TZ);
  assert.equal(nextSendUtc(after, "2026-07-11", "08:00", TZ) - after, 23 * 3600000);
});

test("a fixed send date earlier than the order advances day by day until after it", () => {
  const order = zonedToUtc("2026-07-11", "18:00", TZ);
  const send = nextSendUtc(order, "2026-07-11", "08:00", TZ, "2026-07-11");
  assert.equal(fmtUtc(send) + " " + fmtUtcDate(send), "14:00 12 Jul 2026");
});

test("DST: wait across a spring-forward is a real elapsed duration (Amsterdam, 2026-03-28 22:00 -> 08:00 next day)", () => {
  const order = zonedToUtc("2026-03-28", "22:00", "Europe/Amsterdam");
  const send = nextSendUtc(order, "2026-03-28", "08:00", "Europe/Amsterdam");
  assert.equal(fmtDurDays(send - order), "9 hr 0 min"); // 10 wall-clock hours minus the skipped hour
});
