/* "1-3, 5, 8-" → [[0,1,2],[4],[7..last]] (0-based). Each comma part becomes one group. */
export function parsePageRanges(input, pageCount) {
  const parts = String(input).split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, error: "Enter pages, e.g. 1-3, 5" };
  const groups = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `"${part}" isn't a page or range` };
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : pageCount) : a;
    if (a < 1 || b < 1) return { ok: false, error: "Pages start at 1" };
    if (a > pageCount || b > pageCount) return { ok: false, error: `This PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}` };
    if (a > b) return { ok: false, error: `"${part}" goes backwards` };
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return { ok: true, groups };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
