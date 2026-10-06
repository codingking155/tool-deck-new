/* One-shot local e2e: builds like CI (placeholder Supabase env), serves it with vercel.json's CSP, runs the
   suite, prints only failures + the summary line, and stops the server.
     npm run e2e               every scenario
     npm run e2e -- pdf ip     only scenarios whose name contains "pdf" or "ip" (case-insensitive)  */
import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env, VITE_SUPABASE_URL: "https://e2e.supabase.co", VITE_SUPABASE_ANON_KEY: "e2e-placeholder" };
if (!env.CHROMIUM_PATH && process.platform === "linux") env.CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const port = Number(process.env.E2E_PORT || 4174); // not 4173, so a manual `vite preview` can keep running
const base = `http://localhost:${port}`;
const filters = process.argv.slice(2);

const build = spawnSync("npx", ["vite", "build", "--config", "vite.csp-preview.config.js", "--logLevel", "error"], { env, stdio: "inherit" });
if (build.status) process.exit(build.status);

const server = spawn("npx", ["vite", "preview", "--config", "vite.csp-preview.config.js", "--port", String(port), "--strictPort"], { env, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* already gone */ } };
process.on("exit", stop);

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await fetch(base).then((r) => r.ok, () => false);
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error(`preview server didn't start on ${base}`); process.exit(1); }

/* run.mjs takes one filter; run it once per filter (or once for everything) */
let failed = 0;
for (const f of filters.length ? filters : [""]) {
  const r = spawnSync("node", ["tests/e2e/run.mjs"], { env: { ...env, BASE_URL: base, E2E_FILTER: f }, encoding: "utf8", maxBuffer: 1 << 26 });
  const lines = `${r.stdout}${r.stderr}`.split("\n");
  /* keep FAIL lines with their indented reason, the summary, and anything that isn't routine noise */
  const keep = lines.filter((l, i) => /^\s+FAIL |scenarios passed/.test(l) || (/^\s{7}\S/.test(l) && /FAIL/.test(lines[i - 1] || "")));
  console.log(keep.join("\n") || lines.slice(-5).join("\n"));
  if (r.status) failed = r.status;
}
process.exit(failed);
