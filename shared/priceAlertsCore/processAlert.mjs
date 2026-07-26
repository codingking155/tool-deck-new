import { evaluateAlert, backoffMs, shouldRetry } from "./trigger.mjs";
import { deliverAlert } from "./deliver.mjs";

// Evaluate a single alert against its current price and produce the patch to
// persist plus any delivery audit rows. Pure and idempotent: an already-triggered
// alert (triggered_at set) is never delivered again, so duplicate job runs are safe.
//
// deps: {
//   getCurrentPrice(alert) -> number,
//   providers: { email, whatsapp },
//   productLink(alert) -> string,
//   unsubscribeLink(alert) -> string,
//   now?: number, checkIntervalMs?: number
// }
export async function processAlert(alert, deps) {
  const now = deps.now ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const interval = deps.checkIntervalMs ?? 5 * 60 * 1000;

  const price = await deps.getCurrentPrice(alert);
  const decision = evaluateAlert(alert, price);

  if (decision.action !== "trigger") {
    return {
      currentPrice: price,
      decision,
      deliveries: [],
      patch: { last_checked_at: checkedAt, next_check_at: new Date(now + interval).toISOString() },
    };
  }

  const ctx = {
    currentPrice: price,
    previousPrice: alert.original_price ?? null,
    productUrl: deps.productLink(alert),
    unsubscribeUrl: deps.unsubscribeLink(alert),
  };
  const results = await deliverAlert(alert, ctx, deps.providers);

  const attempt = (alert.attempts || 0) + 1;
  const enabled = [];
  if (alert.email_enabled) enabled.push("email");
  if (alert.whatsapp_enabled) enabled.push("whatsapp");

  const anySent = enabled.some((c) => results[c] && results[c].status === "sent");
  const notification_status = {
    email: alert.email_enabled ? results.email.status : "skipped",
    whatsapp: alert.whatsapp_enabled ? results.whatsapp.status : "skipped",
  };
  const deliveries = enabled.map((c) => ({
    channel: c,
    status: results[c].status,
    provider: results[c].provider || null,
    provider_id: results[c].id || null,
    error: results[c].error || null,
    attempt,
  }));

  let patch;
  let retriesExhausted = false;
  if (anySent) {
    // At least one channel delivered → mark triggered so we never resend.
    patch = {
      last_checked_at: checkedAt,
      status: "triggered",
      triggered_at: checkedAt,
      notification_status,
      attempts: attempt,
      last_error: firstError(results),
    };
  } else {
    // Nothing delivered → stay active, record the failure, back off and retry.
    retriesExhausted = !shouldRetry(attempt);
    patch = {
      last_checked_at: checkedAt,
      status: "active",
      notification_status,
      attempts: attempt,
      last_error: firstError(results),
      next_check_at: new Date(now + backoffMs(attempt)).toISOString(),
    };
  }

  return { currentPrice: price, decision, results, deliveries, patch, retriesExhausted };
}

function firstError(results) {
  for (const c of ["email", "whatsapp"]) {
    if (results[c] && results[c].status === "failed") return `${c}: ${results[c].error || "failed"}`;
  }
  return null;
}
