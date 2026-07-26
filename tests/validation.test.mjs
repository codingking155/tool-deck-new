import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail, normalizePhoneE164, isValidE164, validateTargetPrice,
  validateAlertInput, dedupeKey,
} from "../shared/priceAlertsCore/validation.mjs";
import { makeManageToken, verifyManageToken } from "../shared/priceAlertsCore/tokens.mjs";

const base = {
  productId: "amazon.in/dp/X", productName: "Thing", targetPrice: 999,
  email: "a@b.com", phone: "+919876543210",
  emailEnabled: true, whatsappEnabled: true, consent: true,
};

test("email validation", () => {
  assert.ok(isValidEmail("user@example.com"));
  assert.ok(!isValidEmail("nope"));
  assert.ok(!isValidEmail("a@b"));
  assert.ok(!isValidEmail(""));
});

test("phone E.164 normalisation", () => {
  assert.equal(normalizePhoneE164("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhoneE164("0091-98765-43210"), "+919876543210");
  assert.equal(normalizePhoneE164("98765 43210"), null);   // no country code
  assert.equal(normalizePhoneE164("+0 123"), null);        // starts with 0
  assert.ok(isValidE164("+14165550199"));
  assert.ok(!isValidE164("12345"));
});

test("target price must be > 0", () => {
  assert.ok(validateTargetPrice(1));
  assert.ok(!validateTargetPrice(0));
  assert.ok(!validateTargetPrice(-5));
  assert.ok(!validateTargetPrice("abc"));
});

test("signed-in create is valid", () => {
  const r = validateAlertInput(base, { signedIn: true });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.value.phone, "+919876543210");
});

test("guest create is valid with email + phone", () => {
  const r = validateAlertInput(base, { signedIn: false });
  assert.ok(r.ok);
});

test("invalid email is rejected", () => {
  const r = validateAlertInput({ ...base, email: "bad" }, { signedIn: false });
  assert.ok(!r.ok);
  assert.ok(r.errors.email);
});

test("invalid phone is rejected", () => {
  const r = validateAlertInput({ ...base, phone: "12345" }, { signedIn: false });
  assert.ok(!r.ok);
  assert.ok(r.errors.phone);
});

test("invalid target price is rejected", () => {
  const r = validateAlertInput({ ...base, targetPrice: 0 }, { signedIn: true });
  assert.ok(!r.ok);
  assert.ok(r.errors.targetPrice);
});

test("no channel selected is rejected", () => {
  const r = validateAlertInput({ ...base, emailEnabled: false, whatsappEnabled: false }, { signedIn: true });
  assert.ok(!r.ok);
  assert.ok(r.errors.channels);
});

test("missing consent is rejected", () => {
  const r = validateAlertInput({ ...base, consent: false }, { signedIn: true });
  assert.ok(!r.ok);
  assert.ok(r.errors.consent);
});

test("signed-in may enable only email without a phone", () => {
  const r = validateAlertInput(
    { ...base, whatsappEnabled: false, phone: "" }, { signedIn: true }
  );
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test("dedupe key is identical for same product+contact+target", () => {
  const a = dedupeKey({ productId: "P", userId: "u1", email: "A@b.com", phone: "+91999", targetPrice: 100 });
  const b = dedupeKey({ productId: "P", userId: "u1", email: "a@b.com", phone: "+91999", targetPrice: 100.0 });
  assert.equal(a, b);
});

test("manage token round-trips and rejects tampering", async () => {
  const secret = "test-secret";
  const tok = await makeManageToken("alert-123", secret);
  assert.equal(await verifyManageToken(tok, secret), "alert-123");
  assert.equal(await verifyManageToken(tok + "x", secret), null);
  assert.equal(await verifyManageToken(tok, "other-secret"), null);
});
