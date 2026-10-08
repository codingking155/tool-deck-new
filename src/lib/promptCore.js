/* AI Prompt Generator helpers: draft (de)serialisation and "Open in …" links. Pure, runs under node --test. */

/** Longest URL we hand out, for share links and ?q= prefill alike. */
export const PROMPT_URL_MAX = 6000;

/* [id, label, prefill base (null = no prefill support), plain open URL] */
export const AI_TARGETS = [
  ["chatgpt", "ChatGPT", "https://chatgpt.com/?q=", "https://chatgpt.com/"],
  ["claude", "Claude", "https://claude.ai/new?q=", "https://claude.ai/new"],
  ["gemini", "Gemini", null, "https://gemini.google.com/app"],
];

/** Where an "Open in …" button goes: a prefilled URL, or (no prefill / too long) the plain app URL
    with `copy: true`, meaning the prompt is copied to the clipboard for pasting. */
export function aiOpenPlan(id, prompt, max = PROMPT_URL_MAX) {
  const t = AI_TARGETS.find((x) => x[0] === id);
  if (!t) return null;
  const [, label, prefill, plain] = t;
  if (prefill) {
    const url = prefill + encodeURIComponent(prompt);
    if (url.length <= max) return { label, url, copy: false };
  }
  return { label, url: plain, copy: true };
}

/** Compact, share-friendly form: only non-empty fields, ticked extras as a list. */
export function packDraft({ preset, f, style, extras }) {
  const fields = {};
  for (const [k, v] of Object.entries(f || {})) if (typeof v === "string" && v) fields[k] = v;
  return { p: preset, f: fields, s: style, x: Object.keys(extras || {}).filter((k) => extras[k]) };
}

/** Inverse of packDraft, validated against the tool's own vocab — anything unknown is dropped,
    so stale storage or a hand-edited link can't inject odd state. Returns null when unusable. */
export function unpackDraft(raw, { presets, fields, styles, extras }) {
  if (!raw || typeof raw !== "object" || !raw.f || typeof raw.f !== "object") return null;
  const f = {};
  for (const k of fields) f[k] = typeof raw.f[k] === "string" ? raw.f[k].slice(0, 20000) : "";
  const x = Array.isArray(raw.x) ? raw.x : [];
  return {
    preset: presets.includes(raw.p) ? raw.p : "blank",
    f,
    style: styles.includes(raw.s) ? raw.s : "plain",
    extras: Object.fromEntries(extras.filter((k) => x.includes(k)).map((k) => [k, true])),
  };
}
