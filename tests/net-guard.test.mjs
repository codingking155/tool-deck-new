import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHost } from "../shared/net/ipGuard.mjs";
import { safeFetch } from "../shared/net/safeFetch.mjs";
import { originPolicy, allowedOrigin } from "../shared/net/cors.mjs";

test("ipGuard: trailing dots don't bypass name checks", () => {
  for (const h of ["localhost.", "LOCALHOST..", "db.", "printer.local.", "x.internal."]) assert.equal(classifyHost(h).blocked, true, h);
  assert.equal(classifyHost("example.com.").blocked, false);
  assert.equal(classifyHost("127.0.0.1.").blocked, true);
});

test("ipGuard: fec0::/10 (site-local) and 100::/64 (discard-only) are blocked", () => {
  assert.equal(classifyHost("fec0::1").reason, "site-local-deprecated");
  assert.equal(classifyHost("[feff::1]").reason, "site-local-deprecated");
  assert.equal(classifyHost("100::1").reason, "discard-only");
  assert.equal(classifyHost("100::1:0:0:0:1").blocked, false);   // outside the /64
  assert.equal(classifyHost("2606:4700::1111").blocked, false);
});

test("safeFetch: the deadline covers the body read, not just the headers", async () => {
  const fetchImpl = (_u, init) => Promise.resolve(new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("partial"));
      init.signal.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
    },
  }), { status: 200 }));
  const t0 = Date.now();
  await assert.rejects(safeFetch("https://example.com/", { fetchImpl, timeoutMs: 80, resolve: async () => ["93.184.216.34"] }), /abort/i);
  assert.ok(Date.now() - t0 < 2000);
});

test("cors: fail-closed default allowlist with Vercel previews; ALLOWED_ORIGIN overrides", () => {
  const def = originPolicy(undefined);
  assert.equal(allowedOrigin("https://tooldeck.in", def), "https://tooldeck.in");
  assert.equal(allowedOrigin("http://localhost:5173", def), "http://localhost:5173");
  assert.equal(allowedOrigin("https://tool-deck-git-main-codingking155-9340s-projects.vercel.app", def), "https://tool-deck-git-main-codingking155-9340s-projects.vercel.app");
  assert.equal(allowedOrigin("https://tool-deck-new.vercel.app", def), "https://tool-deck-new.vercel.app");
  for (const o of ["https://evil.com", "https://tooldeck.in.evil.com", "https://evil.vercel.app", "null", null]) assert.equal(allowedOrigin(o, def), null, String(o));

  const custom = originPolicy("https://a.example, https://*.b.example/");
  assert.equal(allowedOrigin("https://a.example", custom), "https://a.example");
  assert.equal(allowedOrigin("https://x.b.example", custom), "https://x.b.example");
  assert.equal(allowedOrigin("https://x.y.b.example", custom), null);
  assert.equal(allowedOrigin("https://tooldeck.in", custom), null);
  assert.equal(allowedOrigin("https://anything", originPolicy("*")), "*");
});
