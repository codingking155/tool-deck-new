/* `npm run typecheck`: runs tsc over the JS sources (tsconfig.json) and fails only on errors that are
   real bugs in untyped JS — undefined names, missing modules/exports (syntax errors already fail the build). The rest of
   checkJs output (inferred prop shapes, DOM narrowing) is noise without annotations, so it's ignored. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const r = spawnSync(process.execPath, [tsc, "-p", ".", "--pretty", "false"], { encoding: "utf8" });
const BLOCKING = /error TS(2304|2305|2307|2552|2614|2724):/;
const errors = `${r.stdout}${r.stderr}`.split("\n").filter((l) => BLOCKING.test(l));
if (r.error) { console.error(r.error.message); process.exit(1); }
if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} type error(s).`); process.exit(1); }
console.log("typecheck: ok");
