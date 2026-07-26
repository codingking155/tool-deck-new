// Trigger rule and retry policy — pure, so they're trivially testable.

// The one rule the whole feature hangs on.
export function shouldTrigger(currentPrice, targetPrice) {
  return Number(currentPrice) <= Number(targetPrice);
}

// Decide what to do with an alert given the freshly-read price.
// Idempotent: an already-triggered/notified alert is never actioned again.
export function evaluateAlert(alert, currentPrice) {
  if (alert.status !== "active") return { action: "skip", reason: "not-active" };
  if (alert.triggered_at) return { action: "skip", reason: "already-triggered" };
  if (!shouldTrigger(currentPrice, alert.target_price)) {
    return { action: "check-only", reason: "above-target" };
  }
  return { action: "trigger", reason: "at-or-below-target" };
}

export const MAX_ATTEMPTS = 5;

// Exponential backoff with a cap, used to schedule the next retry of a failed send.
export function backoffMs(attempt, baseMs = 60_000, capMs = 6 * 3600_000) {
  const ms = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(ms, capMs);
}

export function shouldRetry(attempt) {
  return attempt < MAX_ATTEMPTS;
}
