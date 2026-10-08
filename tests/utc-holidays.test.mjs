import test from "node:test";
import assert from "node:assert/strict";
import {
  zonedToUtc, nextSendUtc, buildOrderRows, skippedDaysFor, cleanHolidays, waitTotals, nowInZone, fmtUtcDate, fmtDurDays,
} from "../src/lib/time.js";

const Z = "Europe/Amsterdam";

test("a holiday pushes the send to the next day even without skip-weekends", () => {
  const order = zonedToUtc("2026-07-07", "18:00", Z); // Tue
  const send = nextSendUtc(order, "2026-07-07", "08:00", Z, "", { holidays: ["2026-07-08"] });
  assert.equal(fmtUtcDate(send), "09 Jul 2026");
  assert.equal(fmtDurDays(send - order), "1 day 14 hr 0 min");
  assert.deepEqual(skippedDaysFor(order, "08:00", Z, "", { holidays: ["2026-07-08"] }), [{ date: "2026-07-08", dow: 3, holiday: true }]);
});

test("holidays combine with skip-weekends: Fri order, Mon holiday -> Tuesday", () => {
  const order = zonedToUtc("2026-07-10", "18:00", Z); // Fri
  const opts = { skipWeekends: true, holidays: ["2026-07-13"] };
  const send = nextSendUtc(order, "2026-07-10", "08:00", Z, "", opts);
  assert.equal(fmtUtcDate(send), "14 Jul 2026");
  const sk = skippedDaysFor(order, "08:00", Z, "", opts);
  assert.deepEqual(sk.map((d) => [d.date, d.holiday]), [["2026-07-11", false], ["2026-07-12", false], ["2026-07-13", true]]);
});

test("a fixed send date on a holiday moves forward; hourly rows honour holidays", () => {
  const order = zonedToUtc("2026-07-06", "10:00", Z);
  const s = nextSendUtc(order, "2026-07-06", "08:00", Z, "2026-07-08", { holidays: ["2026-07-08"] });
  assert.equal(fmtUtcDate(s), "09 Jul 2026");
  const rows = buildOrderRows("2026-07-07", "18:00", "08:00", Z, "", { holidays: ["2026-07-08"] });
  assert.equal(rows.length, 24);
  assert.ok(rows.every((r) => r.targetUtcDate !== "08 Jul 2026"));
});

test("no rules -> no skipped days; holidays before the order are ignored", () => {
  const order = zonedToUtc("2026-07-07", "18:00", Z);
  assert.deepEqual(skippedDaysFor(order, "08:00", Z), []);
  const send = nextSendUtc(order, "2026-07-07", "08:00", Z, "", { holidays: ["2026-07-01"] });
  assert.equal(fmtUtcDate(send), "08 Jul 2026");
});

test("a long run of holidays still resolves (search window widens with the list)", () => {
  const days = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 6, 8 + i)).toISOString().slice(0, 10));
  const order = zonedToUtc("2026-07-07", "18:00", Z);
  const send = nextSendUtc(order, "2026-07-07", "08:00", Z, "", { holidays: days });
  assert.equal(fmtUtcDate(send), "16 Sep 2026");
});

test("cleanHolidays keeps valid unique dates, sorted, capped", () => {
  assert.deepEqual(cleanHolidays(["2026-12-25", "bad", "2026-01-01", "2026-12-25", 5, "2026-13-40"]), ["2026-01-01", "2026-12-25"]);
  assert.deepEqual(cleanHolidays(null), []);
  assert.equal(cleanHolidays(Array.from({ length: 80 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}`), 5).length, 5);
});

test("waitTotals: whole minutes and seconds", () => {
  assert.deepEqual(waitTotals(38 * 3600000), { minutes: 2280, seconds: 136800 });
  assert.deepEqual(waitTotals(89_500), { minutes: 1, seconds: 60 });
  assert.deepEqual(waitTotals(-5), { minutes: 0, seconds: 0 });
});

test("nowInZone gives the zone's wall-clock date and minute", () => {
  const at = new Date("2026-07-11T23:30:45Z");
  assert.deepEqual(nowInZone("Asia/Kolkata", at), { date: "2026-07-12", time: "05:00" });
  assert.deepEqual(nowInZone("America/Mexico_City", at), { date: "2026-07-11", time: "17:30" });
});
