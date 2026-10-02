// Savings maths for alert messages. Current prices come from real observations
// (shared/priceTrackerCore) — there is no price generator in this codebase.

export function computeSavings(originalOrCurrent, current) {
  if (originalOrCurrent == null || current == null) return null;
  const from = Number(originalOrCurrent);
  const now = Number(current);
  if (!(from > 0) || now >= from) return null;
  const amount = Math.round((from - now) * 100) / 100;
  const percent = Math.round((amount / from) * 100);
  return { amount, percent };
}
