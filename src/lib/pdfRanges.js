/** "1-3, 5, 8-" -> zero-based page indices (in written order, duplicates kept). */
export function parseRanges(spec, total) {
  const out = [];
  for (const raw of String(spec).split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`Invalid page range "${part}"`);
    let a, b;
    if (m.length === 2) a = b = Number(m[1]);
    else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : total; }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`Page ${part} is outside 1-${total}`);
    if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
    else for (let i = a; i >= b; i--) out.push(i - 1);
  }
  if (!out.length) throw new Error("Enter at least one page.");
  return out;
}
