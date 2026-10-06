import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOLS, CATEGORIES, WHERE_LABEL } from "../src/toolsMeta.js";

const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");

test("every tool is in the sitemap", () => {
  for (const t of TOOLS) assert.ok(sitemap.includes(`https://tooldeck.in/tool/${t.id}</loc>`), `sitemap is missing /tool/${t.id}`);
});

test("every tool has a known category, a data-location tag, FAQs and a unique id", () => {
  const ids = new Set();
  for (const t of TOOLS) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    assert.ok(CATEGORIES.includes(t.cat), `${t.id}: unknown category ${t.cat}`);
    assert.ok(WHERE_LABEL[t.where], `${t.id}: missing/unknown 'where'`);
    assert.ok(t.faqs?.length >= 3, `${t.id}: needs FAQs for the FAQPage schema`);
  }
});

test("homepage copy never hard-codes a tool count that has gone stale", () => {
  const words = { six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
  for (const file of ["../index.html", "../src/hooks/index.js"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    const m = text.match(/\b(Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen) (fast|private|everyday)/i);
    if (m) assert.equal(words[m[1].toLowerCase()], TOOLS.length, `${file} says "${m[1]}" tools but there are ${TOOLS.length}`);
  }
});
