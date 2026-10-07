/* Tool launcher search: ranks tools by how well a short query hits the name,
   aliases, category and description. Pure — shared by Home and the palette.
   Name hits return the matched character indices so the UI can emphasise them. */

const norm = (s) => String(s || "").toLowerCase();
const isBoundary = (s, i) => i === 0 || /[\s\-→&/.(]/.test(s[i - 1]);

/* Contiguous substring first; otherwise a subsequence (e.g. "jsf" → "JSon Formatter")
   that must start on a word boundary. Returns { idx, score } or null. */
export function matchText(text, q) {
  const t = norm(text);
  if (!q) return null;
  const at = t.indexOf(q);
  if (at !== -1) {
    const idx = Array.from({ length: q.length }, (_, i) => at + i);
    const score = (at === 0 ? 100 : isBoundary(t, at) ? 80 : 55) + Math.min(q.length, 8);
    return { idx, score };
  }
  if (q.length < 2) return null;
  const idx = [];
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    /* prefer the next word-start occurrence, fall back to any occurrence */
    for (let i = from; i < t.length; i++) if (t[i] === ch && isBoundary(t, i)) { found = i; break; }
    if (found === -1) found = t.indexOf(ch, from);
    if (found === -1) return null;
    idx.push(found); from = found + 1;
  }
  if (!isBoundary(t, idx[0])) return null;
  const spread = idx[idx.length - 1] - idx[0];
  const starts = idx.filter((i) => isBoundary(t, i)).length;
  return { idx, score: Math.max(8, 40 + starts * 6 - spread) };
}

/** Rank tools for a query. Empty query → all tools, original order, no highlight. */
export function searchTools(tools, query) {
  const q = norm(query).trim().replace(/\s+/g, " ");
  if (!q) return tools.map((tool) => ({ tool, score: 0, hl: [] }));
  const words = q.split(" ");
  const out = [];
  for (const tool of tools) {
    const whole = matchText(tool.name, q);
    let score = whole ? whole.score * 1.4 : 0;
    let hl = whole ? whole.idx : [];
    let ok = true;
    for (const w of words) {
      const n = matchText(tool.name, w);
      const kw = (tool.kw || "").split(" ").some((k) => k.startsWith(w)) ? 45 : 0;
      const cat = norm(tool.cat).includes(w) ? 22 : 0;
      const desc = w.length > 2 && norm(tool.desc).includes(w) ? 14 : 0;
      const id = norm(tool.id).startsWith(w) ? 30 : 0;
      const best = Math.max(n ? n.score : 0, kw, cat, desc, id);
      if (!best) { ok = false; break; }
      score += best;
      if (!whole && n) hl = hl.concat(n.idx);
    }
    if (ok) out.push({ tool, score: score - (tool.beta ? 3 : 0), hl: [...new Set(hl)].sort((a, b) => a - b) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Split a label into [{ text, hit }] runs from matched indices. */
export function highlightRuns(text, idx) {
  if (!idx || !idx.length) return [{ text, hit: false }];
  const set = new Set(idx);
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
