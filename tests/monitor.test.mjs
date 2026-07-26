import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTrigger } from "../shared/priceAlertsCore/trigger.mjs";
import { processAlert } from "../shared/priceAlertsCore/processAlert.mjs";
import { createMockEmailProvider, createMockWhatsappProvider } from "../shared/priceAlertsCore/providersMock.mjs";

function makeAlert(over = {}) {
  return {
    id: "a1", product_id: "P1", product_name: "Widget", currency: "INR",
    email: "a@b.com", phone: "+919876543210", target_price: 1000, original_price: 1500,
    email_enabled: true, whatsapp_enabled: true,
    status: "active", triggered_at: null, attempts: 0,
    notification_status: { email: "pending", whatsapp: "pending" },
    ...over,
  };
}
function deps(price, providers) {
  return {
    getCurrentPrice: () => price,
    providers,
    productLink: () => "https://tooldeck.in/tool/price?p=P1",
    unsubscribeLink: () => "https://x/unsub?token=t",
    now: 1_700_000_000_000,
  };
}

test("trigger boundaries: above / equal / below", () => {
  assert.equal(shouldTrigger(1001, 1000), false);
  assert.equal(shouldTrigger(1000, 1000), true);
  assert.equal(shouldTrigger(999, 1000), true);
});

test("price above target → check-only, no send", async () => {
  const email = createMockEmailProvider(), wa = createMockWhatsappProvider();
  const r = await processAlert(makeAlert(), deps(1200, { email, whatsapp: wa }));
  assert.equal(r.decision.action, "check-only");
  assert.equal(email.sent.length, 0);
  assert.equal(wa.sent.length, 0);
  assert.equal(r.patch.status, undefined); // stays active; only check fields patched
  assert.ok(r.patch.next_check_at);
});

test("price equal to target → triggers and sends both channels", async () => {
  const email = createMockEmailProvider(), wa = createMockWhatsappProvider();
  const r = await processAlert(makeAlert(), deps(1000, { email, whatsapp: wa }));
  assert.equal(r.decision.action, "trigger");
  assert.equal(r.patch.status, "triggered");
  assert.equal(email.sent.length, 1);
  assert.equal(wa.sent.length, 1);
  assert.equal(r.patch.notification_status.email, "sent");
  assert.equal(r.patch.notification_status.whatsapp, "sent");
});

test("price below target → triggers", async () => {
  const email = createMockEmailProvider(), wa = createMockWhatsappProvider();
  const r = await processAlert(makeAlert(), deps(800, { email, whatsapp: wa }));
  assert.equal(r.patch.status, "triggered");
  assert.equal(r.deliveries.filter((d) => d.status === "sent").length, 2);
});

test("already-triggered alert is idempotent (duplicate job run)", async () => {
  const email = createMockEmailProvider(), wa = createMockWhatsappProvider();
  const alert = makeAlert({ status: "triggered", triggered_at: "2024-01-01T00:00:00Z" });
  const r = await processAlert(alert, deps(500, { email, whatsapp: wa }));
  assert.notEqual(r.decision.action, "trigger");
  assert.equal(email.sent.length, 0);
  assert.equal(wa.sent.length, 0);
});

test("WhatsApp down but email ok → alert still triggered, WA failure recorded", async () => {
  const email = createMockEmailProvider();
  const wa = createMockWhatsappProvider({ fail: true });
  const r = await processAlert(makeAlert(), deps(900, { email, whatsapp: wa }));
  assert.equal(r.patch.status, "triggered");        // not blocked by WhatsApp outage
  assert.equal(r.patch.notification_status.email, "sent");
  assert.equal(r.patch.notification_status.whatsapp, "failed");
  assert.equal(email.sent.length, 1);
});

test("all channels fail → stays active, backs off, retry scheduled", async () => {
  const email = createMockEmailProvider({ fail: true });
  const wa = createMockWhatsappProvider({ fail: true });
  const alert = makeAlert({ attempts: 0 });
  const r = await processAlert(alert, deps(900, { email, whatsapp: wa }));
  assert.equal(r.patch.status, "active");
  assert.equal(r.patch.attempts, 1);
  assert.ok(r.patch.last_error);
  assert.ok(new Date(r.patch.next_check_at).getTime() > deps(900).now);
  assert.equal(r.retriesExhausted, false);
});

test("retries give up after MAX attempts", async () => {
  const email = createMockEmailProvider({ fail: true });
  const wa = createMockWhatsappProvider({ fail: true });
  const r = await processAlert(makeAlert({ attempts: 4 }), deps(900, { email, whatsapp: wa }));
  assert.equal(r.patch.attempts, 5);
  assert.equal(r.retriesExhausted, true);
});

test("savings appear in the email payload", async () => {
  const email = createMockEmailProvider(), wa = createMockWhatsappProvider();
  await processAlert(makeAlert({ original_price: 1500 }), deps(900, { email, whatsapp: wa }));
  assert.match(email.sent[0].html, /you save/i);
});
