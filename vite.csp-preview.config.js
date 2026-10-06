/* Serves a build with vercel.json's security headers (CSP etc.) so the e2e suite runs
   under the production policy:  npm run preview:csp  then  npm run test:e2e */
import base from "./vite.config.js";
import { readFileSync } from "node:fs";
const vercel = JSON.parse(readFileSync("./vercel.json", "utf8"));
const pick = (rule) => Object.fromEntries(rule.headers.filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.value.replace("upgrade-insecure-requests", "")]));
const site = pick(vercel.headers[0]), sheaf = pick(vercel.headers.find((r) => r.source === "/sheaf/(.*)"));
/* Sheaf (/sheaf/) has its own rule so the PDF Toolkit can frame it; everything else gets the site policy. */
const csp = { name: "csp-headers", configurePreviewServer(server) {
  server.middlewares.use((req, res, next) => { for (const [k, v] of Object.entries(req.url.startsWith("/sheaf/") ? sheaf : site)) res.setHeader(k, v); next(); });
} };
export default (env) => { const b = base(env); return { ...b, plugins: [...b.plugins, csp], build: { ...b.build, outDir: "dist-csp" } }; };
