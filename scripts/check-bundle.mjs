// First-paint JS budget: the entry script + its modulepreloads from dist/index.html (gzipped).
// Tools and decorative pieces are lazy chunks and don't count. Raise the budget deliberately.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 90;
const html = readFileSync("dist/index.html", "utf8");
const files = [...html.matchAll(/(?:src|href)="\/(js\/[^"]+\.js)"/g)].map((m) => m[1]);
const kb = files.reduce((n, f) => n + gzipSync(readFileSync(`dist/${f}`)).length, 0) / 1024;
if (kb > BUDGET_KB) {
  console.error(`First-paint JS is ${kb.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB): ${files.join(", ")}`);
  process.exit(1);
}
