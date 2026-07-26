import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zonedToUtc, localDateOf, nextLocalDate, getNextValidSendUtc,
  buildWaitSchedule, getDateTimeWarning, offsetLabel,
} from "../src/lib/time.js";

test("wall-clock → UTC round-trips a plain time (IST, no DST)", () => {
  const utc = zonedToUtc("2026-07-24", "18:00", "Asia/Kolkata");
  assert.equal(utc.toISOString(), "2026-07-24T12:30:00.000Z"); // IST = UTC+5:30
});

test("primary requirement: Friday 18:00 order → Monday send (weekends skipped)", () => {
  // Friday 24 Jul 2026, 18:00 IST; send time 08:00 local
  const orderUtc = zonedToUtc("2026-07-24", "18:00", "Asia/Kolkata");
  const { sendUtc, skippedDays } = getNextValidSendUtc(orderUtc, "08:00", "Asia/Kolkata");
  assert.equal(localDateOf(sendUtc, "Asia/Kolkata"), "2026-07-27"); // Monday
  assert.equal(skippedDays.length, 2); // Sat + Sun rejected and reported
  assert.deepEqual(skippedDays.map((s) => s.date), ["2026-07-25", "2026-07-26"]);
});

test("skipWeekends=false sends the very next morning", () => {
  const orderUtc = zonedToUtc("2026-07-24", "18:00", "Asia/Kolkata");
  const { sendUtc } = getNextValidSendUtc(orderUtc, "08:00", "Asia/Kolkata", { skipWeekends: false });
  assert.equal(localDateOf(sendUtc, "Asia/Kolkata"), "2026-07-25"); // Saturday allowed
});

test("day advancement is DST-safe (US spring-forward, 2026-03-08)", () => {
  // 2026-03-07 → next local day must be 2026-03-08 even though 02:00 doesn't exist
  assert.equal(nextLocalDate("2026-03-07", "America/New_York"), "2026-03-08");
  assert.equal(nextLocalDate("2026-03-08", "America/New_York"), "2026-03-09");
});

test("send-time resolution crosses a DST gap without drifting the local time", () => {
  // Order Sat 2026-03-07 23:00 ET, send 09:00 → Monday 2026-03-09 09:00 EDT (UTC-4)
  const orderUtc = zonedToUtc("2026-03-07", "23:00", "America/New_York");
  const { sendUtc } = getNextValidSendUtc(orderUtc, "09:00", "America/New_York");
  assert.equal(localDateOf(sendUtc, "America/New_York"), "2026-03-09");
  assert.equal(sendUtc.toISOString(), "2026-03-09T13:00:00.000Z"); // 09:00 EDT
});

test("getDateTimeWarning flags a nonexistent local time inside the DST gap", () => {
  const w = getDateTimeWarning("2026-03-08", "02:30", "America/New_York", "The order time");
  assert.ok(w && /transition/.test(w));
});

test("buildWaitSchedule clamps repetitions and marks weekends in the local zone", () => {
  const rows = buildWaitSchedule({
    startDate: "2026-07-24", startTime: "12:00", amount: 24, unit: "hours",
    repetitions: 999, tz1: "Asia/Kolkata", tz2: null,
  });
  assert.equal(rows.length, 120); // clamped
  assert.equal(rows[0].utcTime, "12:00");
  assert.equal(rows[0].localTime, "17:30"); // IST
  const sat = rows.find((r) => r.localDayStr === "2026-07-25");
  assert.ok(sat.isWeekend);
});

test("offsetLabel formats whole and half-hour offsets", () => {
  const d = new Date("2026-07-24T00:00:00Z");
  assert.equal(offsetLabel("Asia/Kolkata", d), "GMT+5:30");
  assert.equal(offsetLabel("UTC", d), "GMT");
});
