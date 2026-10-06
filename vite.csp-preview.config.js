/* Serves a build with vercel.json's security headers (CSP etc.) so the e2e suite runs
   under the production policy:  npm run preview:csp  then  npm run test:e2e */
import base from "./vite.config.js";
import { readFileSync } from "node:fs";
const vercel = JSON.parse(readFileSync("./vercel.json", "utf8"));
const headers = Object.fromEntries(vercel.headers[0].headers.filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.value.replace("upgrade-insecure-requests", "")]));
export default (env) => ({ ...base(env), build: { ...base(env).build, outDir: "dist-csp" }, preview: { headers } });
