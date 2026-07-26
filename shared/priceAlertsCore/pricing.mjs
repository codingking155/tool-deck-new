// The single seam between "alerts" and "what a product costs right now".
//
// ToolDeck has no real product catalog, so the default price source is the same
// deterministic, seeded generator the Price Tracker tool already uses (clearly a
// BETA/demo source). When you have a real catalog, replace `currentPrice` — or,
// better, pass a `getCurrentPrice(alert)` implementation into the monitor — and
// nothing else in the pipeline changes.

function seedFrom(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic within a coarse time bucket so prices "move" day to day but are
// stable inside a single check window (keeps the job idempotent within a run).
export function currentPrice(productRef, at = Date.now()) {
  const bucket = Math.floor(at / (6 * 3600 * 1000)); // 6-hour buckets
  const rnd = mulberry32(seedFrom(String(productRef) + ":" + bucket));
  const base = 800 + Math.floor(seedFrom(String(productRef)) % 60000);
  const swing = (rnd() - 0.45) * base * 0.12;
  const dip = rnd() < 0.06 ? -base * (0.1 + rnd() * 0.12) : 0; // occasional sale
  return Math.max(1, Math.round(base + swing + dip));
}

export function computeSavings(originalOrCurrent, current) {
  if (originalOrCurrent == null || current == null) return null;
  const from = Number(originalOrCurrent);
  const now = Number(current);
  if (!(from > 0) || now >= from) return null;
  const amount = Math.round((from - now) * 100) / 100;
  const percent = Math.round((amount / from) * 100);
  return { amount, percent };
}
