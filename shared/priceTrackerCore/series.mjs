// Price time-series logic — pure, shared by the Edge Functions, the UI and tests.
//
// Observations are real readings: {price|null, availability, seller, observedAt, source}.
// A price holds until the next observation (step series), so averages are
// time-weighted and nothing between readings is invented.

const DAY = 86_400_000;
export const HEARTBEAT_MS = DAY;

const cents = (p) => (p == null ? null : Math.round(Number(p) * 100));
const t = (iso) => new Date(iso).getTime();

/**
 * Should a fresh reading become a new stored observation?
 * Yes when price/availability/seller changed, or when the last stored one is
 * older than the heartbeat (a daily "still this price" data point).
 */
export function shouldRecord(latest, next, { heartbeatMs = HEARTBEAT_MS } = {}) {
  if (!next) return false;
  if (!latest) return true;
  if (t(next.observedAt) <= t(latest.observedAt)) return false;
  if (cents(next.price) !== cents(latest.price)) return true;
  if ((next.availability ?? null) !== (latest.availability ?? null)) return true;
  if (next.seller != null && next.seller !== (latest.seller ?? null)) return true;
  return t(next.observedAt) - t(latest.observedAt) >= heartbeatMs;
}

/** Sort ascending by time and drop exact duplicates (same time + source). */
export function normalizeObservations(obs) {
  const seen = new Set();
  return [...(obs || [])]
    .filter((o) => o && o.observedAt && Number.isFinite(t(o.observedAt)))
    .sort((a, b) => t(a.observedAt) - t(b.observedAt))
    .filter((o) => { const k = `${o.observedAt}|${o.source}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Range statistics over real observations.
 * @param obs      observations (any order)
 * @param opts.now        reference time (ms)
 * @param opts.rangeDays  window size, or null for all recorded history
 * @param opts.asOf       last time the current price was confirmed (ISO) — extends the final step
 */
export function priceStats(obs, { now = Date.now(), rangeDays = null, asOf = null } = {}) {
  const all = normalizeObservations(obs);
  const priced = all.filter((o) => o.price != null);
  if (!priced.length) return null;

  // The series ends at the last confirmation of the current price — never extended past it.
  const end = Math.max(t(all[all.length - 1].observedAt), asOf ? t(asOf) : 0);
  const start = rangeDays == null ? t(all[0].observedAt) : Math.max(t(all[0].observedAt), Math.min(now, end) - rangeDays * DAY);

  // The reading in force at `start` (may predate the window) plus every reading inside it.
  const inWindow = [];
  for (const o of all) {
    const ot = t(o.observedAt);
    if (ot <= start) { inWindow.length = 0; inWindow.push(o); }
    else if (ot <= end) inWindow.push(o);
  }

  let lowest = null, highest = null, weighted = 0, weight = 0;
  for (let i = 0; i < inWindow.length; i++) {
    const o = inWindow[i];
    if (o.price == null) continue;
    const from = Math.max(start, t(o.observedAt));
    const to = i + 1 < inWindow.length ? t(inWindow[i + 1].observedAt) : end;
    if (!lowest || o.price < lowest.price) lowest = { price: o.price, observedAt: o.observedAt };
    if (!highest || o.price > highest.price) highest = { price: o.price, observedAt: o.observedAt };
    if (to > from) { weighted += o.price * (to - from); weight += to - from; }
  }

  // Current = the latest reading, only if it has a price (out of stock → no current price).
  const latest = all[all.length - 1];
  const current = latest.price != null ? latest : null;
  const latestPriced = priced[priced.length - 1];
  const first = inWindow.find((o) => o.price != null) || null;
  const average = weight > 0 ? Math.round((weighted / weight) * 100) / 100 : latestPriced.price;
  const coverageDays = (end - Math.max(start, t(priced[0].observedAt))) / DAY;
  const pointCount = inWindow.filter((o) => o.price != null && t(o.observedAt) >= start).length || (first ? 1 : 0);

  const change = current && first && first.price
    ? { amount: Math.round((current.price - first.price) * 100) / 100, percent: ((current.price - first.price) / first.price) * 100, since: first.observedAt }
    : null;

  // An opinion is only offered once there's enough real history to back it.
  let insight = null;
  const enoughHistory = coverageDays >= 14 && priced.length >= 3;
  if (current && enoughHistory) {
    const vsAvg = ((current.price - average) / average) * 100;
    if (lowest && current.price <= lowest.price && coverageDays >= 30) insight = { kind: "lowest", vsAverage: vsAvg };
    else if (vsAvg <= -5) insight = { kind: "low", vsAverage: vsAvg };
    else if (vsAvg >= 5) insight = { kind: "high", vsAverage: vsAvg };
    else insight = { kind: "typical", vsAverage: vsAvg };
  }

  return {
    current: current ? { price: current.price, observedAt: current.observedAt } : null,
    lastKnown: { price: latestPriced.price, observedAt: latestPriced.observedAt },
    lowest, highest, average, change,
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), rangeDays },
    coverageDays, pointCount,
    trackedSince: priced[0].observedAt,
    enoughHistory, insight,
  };
}
