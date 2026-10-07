import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
const directive = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || "").split(/\s+/).slice(1);

/* tesseract.js loads its worker and core from jsDelivr at its own installed versions (OCR PDF tool);
   the CSP allows only those paths, so an upgrade must update vercel.json in the same commit. */
test("CSP allows the jsDelivr paths of the installed tesseract.js and nothing broader", () => {
  const tess = req("tesseract.js/package.json");
  const core = tess.dependencies["tesseract.js-core"].replace(/^[^\d]*/, "");
  const script = directive("script-src"), connect = directive("connect-src");
  assert.ok(script.includes(`https://cdn.jsdelivr.net/npm/tesseract.js@v${tess.version}/`), `script-src needs tesseract.js@v${tess.version}`);
  assert.ok(script.includes(`https://cdn.jsdelivr.net/npm/tesseract.js-core@v${core}/`), `script-src needs tesseract.js-core@v${core}`);
  assert.ok(connect.includes(`https://cdn.jsdelivr.net/npm/tesseract.js-core@v${core}/`));
  assert.ok(connect.includes("https://cdn.jsdelivr.net/npm/@tesseract.js-data/"));
  for (const src of [...script, ...connect]) assert.ok(!/^https:\/\/cdn\.jsdelivr\.net\/?$/.test(src), "no whole-CDN jsDelivr allowance");
  assert.ok(!connect.includes("https://*.onrender.com"), "no wildcard onrender.com");
});
