/** Seeded demo price history — deterministic per URL so shared links reproduce the same chart.
    Production needs licensed/affiliate feeds with genuinely recorded history. */

function seedFrom(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoHistory(url, days) {
  const rnd = mulberry32(seedFrom(url || "demo"));
  const base = 800 + Math.floor(rnd() * 60000);
  const points = [];
  let p = base;
  const step = Math.max(1, Math.floor(days / 120));
  for (let d = days; d >= 0; d -= step) {
    p = Math.max(base * 0.55, Math.min(base * 1.45, p + (rnd() - 0.495) * base * 0.05));
    if (rnd() < 0.04) p *= 0.82 + rnd() * 0.1; // sale dip
    points.push({ d, price: Math.round(p) });
  }
  return points;
}

export const inr = (n) => "₹" + n.toLocaleString("en-IN");
