import test from "node:test";
import assert from "node:assert/strict";
import { nextSteps, parseRetryAfter } from "../src/lib/breach.js";
import { isSevereType } from "../shared/breachCore/index.mjs";

const has = (steps, re) => steps.some((s) => re.test(s));

test("nextSteps: passwords → change + unique passwords/manager, plus the generic steps", () => {
  const s = nextSteps(["Email addresses", "Passwords"]);
  assert.match(s[0], /Change the password/);
  assert.ok(has(s, /password manager/));
  assert.ok(has(s, /two-factor/));
  assert.ok(has(s, /phishing/));
  assert.ok(!has(s, /SIM|bank|identity theft/));
});

test("nextSteps: phone, card/bank and personal details each add their own step", () => {
  assert.ok(has(nextSteps(["Phone numbers"]), /SIM-swap/));
  assert.ok(has(nextSteps(["Credit cards"]), /contact your bank/));
  assert.ok(has(nextSteps(["Bank account numbers"]), /contact your bank/));
  assert.ok(has(nextSteps(["Physical addresses"]), /identity theft/));
  assert.ok(has(nextSteps(["Dates of birth"]), /identity theft/));
  assert.ok(has(nextSteps(["Security questions and answers"]), /security-question/));
});

test("nextSteps: email/IP 'addresses' are not physical addresses", () => {
  const s = nextSteps(["Email addresses", "IP addresses", "Names"]);
  assert.ok(!has(s, /identity theft/));
  assert.ok(has(s, /reused one on these sites/)); // no passwords listed → softer reminder
  assert.ok(has(s, /two-factor/) && has(s, /phishing/));
});

test("nextSteps: unknown/empty types fall back to the password steps; output is de-duplicated", () => {
  for (const v of [[], undefined, null]) assert.match(nextSteps(v)[0], /Change the password/);
  const s = nextSteps(["Passwords", "Password hints", "Credit cards", "Credit card CVV"]);
  assert.equal(s.length, new Set(s).size);
  assert.equal(s.filter((x) => /contact your bank/.test(x)).length, 1);
});

test("parseRetryAfter: JSON number, delta-seconds header, HTTP-date, junk", () => {
  assert.equal(parseRetryAfter(42), 42);
  assert.equal(parseRetryAfter(7.2), 8);
  assert.equal(parseRetryAfter("30"), 30);
  assert.equal(parseRetryAfter(0), 1);
  assert.equal(parseRetryAfter(999999), 3600);
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:01:30 GMT", now), 90);
  for (const v of [null, undefined, "", "soon", NaN]) assert.equal(parseRetryAfter(v), null);
});

test("isSevereType flags sensitive data types only", () => {
  assert.ok(isSevereType("Passwords") && isSevereType("Credit cards"));
  assert.ok(!isSevereType("Email addresses") && !isSevereType("Names"));
});
