import { test } from "node:test";
import assert from "node:assert/strict";
import { aiOpenPlan, packDraft, unpackDraft, PROMPT_URL_MAX } from "../src/lib/promptCore.js";

const VOCAB = { presets: ["blank", "email"], fields: ["task", "context", "role"], styles: ["plain", "xml"], extras: ["think", "ask"] };

test("aiOpenPlan: ChatGPT and Claude prefill via ?q=, Gemini copies", () => {
  const p = "Write a haiku & explain #1?";
  assert.deepEqual(aiOpenPlan("chatgpt", p), { label: "ChatGPT", url: `https://chatgpt.com/?q=${encodeURIComponent(p)}`, copy: false });
  assert.equal(aiOpenPlan("claude", p).url, "https://claude.ai/new?q=Write%20a%20haiku%20%26%20explain%20%231%3F");
  assert.deepEqual(aiOpenPlan("gemini", p), { label: "Gemini", url: "https://gemini.google.com/app", copy: true });
  assert.equal(aiOpenPlan("nope", p), null);
});

test("aiOpenPlan: prompts too long for a URL fall back to copy + open", () => {
  const long = "é".repeat(PROMPT_URL_MAX / 4);
  for (const id of ["chatgpt", "claude"]) {
    const plan = aiOpenPlan(id, long);
    assert.equal(plan.copy, true);
    assert.ok(!plan.url.includes("?q="));
  }
  assert.equal(aiOpenPlan("chatgpt", "x".repeat(100)).copy, false);
});

test("packDraft/unpackDraft round-trip and drop unknown state", () => {
  const d = { preset: "email", f: { task: "T", context: "", role: "R" }, style: "xml", extras: { think: true, ask: false } };
  const packed = packDraft(d);
  assert.deepEqual(packed, { p: "email", f: { task: "T", role: "R" }, s: "xml", x: ["think"] });
  assert.deepEqual(unpackDraft(JSON.parse(JSON.stringify(packed)), VOCAB), { ...d, extras: { think: true } });

  const odd = unpackDraft({ p: "evil", f: { task: 5, role: "ok", __proto__x: "y" }, s: "html", x: ["think", "rm"] }, VOCAB);
  assert.deepEqual(odd, { preset: "blank", f: { task: "", context: "", role: "ok" }, style: "plain", extras: { think: true } });
  assert.equal(unpackDraft(null, VOCAB), null);
  assert.equal(unpackDraft({ p: "email" }, VOCAB), null);
  assert.equal(unpackDraft("str", VOCAB), null);
});
