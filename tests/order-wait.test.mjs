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

test("DST: Sydney spring-forward night loses an hour (22:00 -> 08:00 is 9 hr)", () => {
  const z = "Australia/Sydney";
  const order = zonedToUtc("2026-10-03", "22:00", z);
  assert.equal(fmtDurDays(nextSendUtc(order, "2026-10-03", "08:00", z) - order), "9 hr 0 min");
});

test("DST: Lord Howe's 30-minute fall-back adds 30 min (22:00 -> 08:00 is 10 hr 30 min)", () => {
  const z = "Australia/Lord_Howe";
  const order = zonedToUtc("2026-04-04", "22:00", z);
  assert.equal(fmtDurDays(nextSendUtc(order, "2026-04-04", "08:00", z) - order), "10 hr 30 min");
});

test("DST: New York fall-back adds an hour (00:30 -> 08:00 is 8 hr 30 min)", () => {
  const z = "America/New_York";
  const order = zonedToUtc("2026-11-01", "00:30", z);
  assert.equal(fmtDurDays(nextSendUtc(order, "2026-11-01", "08:00", z) - order), "8 hr 30 min");
});

test("hourly table stays 24 rows with positive waits across a DST change", () => {
  const rows = buildOrderRows("2026-03-28", "22:00", "08:00", "Europe/Amsterdam");
  assert.equal(rows.length, 24);
  assert.ok(rows.every((r) => !r.wait.startsWith("-") && !r.wait.startsWith("0 hr 0")));
  assert.ok(rows.some((r) => r.offset === "GMT+1") && rows.some((r) => r.offset === "GMT+2"));
});

import { skippedWeekendDays } from "../src/lib/time.js";
import { buildIcs, googleCalendarUrl } from "../src/lib/ics.js";

test("skip weekends: Friday 18:00 order, 08:00 send -> Monday 08:00 (Sat+Sun skipped); default still Saturday", () => {
  const z = "Europe/Amsterdam";
  const order = zonedToUtc("2026-07-10", "18:00", z); // a Friday
  const sat = nextSendUtc(order, "2026-07-10", "08:00", z);
  assert.equal(fmtDurDays(sat - order), "14 hr 0 min");
  const mon = nextSendUtc(order, "2026-07-10", "08:00", z, "", { skipWeekends: true });
  assert.equal(fmtDurDays(mon - order), "2 days 14 hr 0 min");
  assert.deepEqual(skippedWeekendDays(order, "08:00", z).map((d) => d.date), ["2026-07-11", "2026-07-12"]);
});

test("skip weekends also moves a fixed weekend send date to Monday; hourly rows honour it", () => {
  const z = "Europe/Amsterdam";
  const order = zonedToUtc("2026-07-08", "10:00", z);
  const s = nextSendUtc(order, "2026-07-08", "08:00", z, "2026-07-11", { skipWeekends: true });
  assert.equal(fmtUtcDate(s), "13 Jul 2026");
  const rows = buildOrderRows("2026-07-10", "18:00", "08:00", z, "", { skipWeekends: true });
  assert.ok(rows.every((r) => r.targetUtcDate !== "11 Jul 2026" && r.targetUtcDate !== "12 Jul 2026"));
});

test("buildIcs: valid CRLF structure, UTC times, escaping and folding", () => {
  const ics = buildIcs({ title: "Send; offer, now", startUtc: new Date("2026-07-13T14:00:00Z"), durationMin: 30,
    description: "x".repeat(200), uid: "u1@t", now: new Date("2026-07-01T00:00:00Z") });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(ics.includes("DTSTART:20260713T140000Z\r\n") && ics.includes("DTEND:20260713T143000Z\r\n"));
  assert.ok(ics.includes("SUMMARY:Send\; offer\\, now\r\n"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line.length}`);
  assert.ok(ics.includes("\r\n x"), "long description is folded");
});

test("googleCalendarUrl", () => {
  const u = new URL(googleCalendarUrl({ title: "Send", startUtc: new Date("2026-07-13T14:00:00Z"), durationMin: 15 }));
  assert.equal(u.searchParams.get("dates"), "20260713T140000Z/20260713T141500Z");
  assert.equal(u.hostname, "calendar.google.com");
});
