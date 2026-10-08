import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedAgo, expiryReminder } from "../src/lib/sslView.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");

test("checkedAgo buckets", () => {
  assert.equal(checkedAgo("2026-10-08T09:59:40Z", NOW), "just now");
  assert.equal(checkedAgo("2026-10-08T10:00:30Z", NOW), "just now");   // server clock ahead
  assert.equal(checkedAgo("2026-10-08T09:57:00Z", NOW), "3 min ago");
  assert.equal(checkedAgo("2026-10-08T08:00:00Z", NOW), "2 h ago");
  assert.equal(checkedAgo("2026-10-07T10:00:00Z", NOW), "1 day ago");
  assert.equal(checkedAgo("nope", NOW), null);
  assert.equal(checkedAgo(undefined, NOW), null);
});

test("expiryReminder: 14 days before at 09:00 local, with an alarm", () => {
  const now = new Date(NOW);
  const r = expiryReminder({ host: "example.com", notAfter: "2026-12-31T23:59:59Z", now });
  assert.equal(r.leadDays, 14);
  assert.equal(r.startUtc.getHours(), 9);
  const lead = (Date.parse("2026-12-31T23:59:59Z") - r.startUtc.getTime()) / 86_400_000;
  assert.ok(lead > 13 && lead < 16, `lead ${lead}`);
  assert.equal(r.filename, "ssl-expiry-example.com.ics");
  assert.match(r.ics, /BEGIN:VEVENT/);
  assert.match(r.ics, /SUMMARY:Renew SSL certificate for example\.com/);
  assert.match(r.ics, /BEGIN:VALARM/);
  assert.match(r.ics, /UID:ssl-expiry-example\.com-2026-12-31@tooldeck\.in/);
});

test("expiryReminder falls back to the day before, then gives up", () => {
  const now = new Date(NOW);
  const soon = expiryReminder({ host: "a.io", notAfter: "2026-10-15T12:00:00Z", now });
  assert.equal(soon.leadDays, 1);
  assert.ok(soon.startUtc > now);
  assert.equal(expiryReminder({ host: "a.io", notAfter: "2026-10-08T20:00:00Z", now }), null);
  assert.equal(expiryReminder({ host: "a.io", notAfter: "2026-01-01T00:00:00Z", now }), null);
  assert.equal(expiryReminder({ host: "a.io", notAfter: "garbage", now }), null);
  assert.equal(expiryReminder({ host: "", notAfter: "2027-01-01T00:00:00Z", now }), null);
});
