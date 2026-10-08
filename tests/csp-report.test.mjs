import test from "node:test";
import assert from "node:assert/strict";
import { parseCspReports, blockedOf, pageOf, MAX_REPORTS } from "../shared/cspReport/index.mjs";

test("report-uri shape (application/csp-report) is reduced to origins and path prefixes", () => {
  const body = JSON.stringify({ "csp-report": {
    "document-uri": "https://x.app/tool/phone/+919876543210?q=1#h",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example.com/a.js?token=abc",
    "source-file": "https://x.app/js/index-abc.js?v=1",
    "script-sample": "secret()",
    "disposition": "enforce",
  } });
  assert.deepEqual(parseCspReports(body, "application/csp-report"), [{
    directive: "script-src-elem", blocked: "https://evil.example.com", page: "/tool/phone",
    source: "https://x.app/js/index-abc.js", disposition: "enforce",
  }]);
});

test("report-to shape (application/reports+json): only csp-violation entries, capped", () => {
  const one = { type: "csp-violation", body: { documentURL: "https://x.app/", effectiveDirective: "connect-src", blockedURL: "https://api.new.example/v1", disposition: "report" } };
  const body = JSON.stringify([one, { type: "deprecation", body: {} }, ...Array(30).fill(one)]);
  const out = parseCspReports(body, "application/reports+json");
  assert.equal(out.length, MAX_REPORTS);
  assert.deepEqual(out[0], { directive: "connect-src", blocked: "https://api.new.example", page: "/", source: "", disposition: "report" });
});

test("extension noise, junk and oversized bodies are dropped", () => {
  const ext = JSON.stringify({ "csp-report": { "document-uri": "https://x.app/", "violated-directive": "script-src", "blocked-uri": "chrome-extension://abc/x.js" } });
  assert.deepEqual(parseCspReports(ext, "application/csp-report"), []);
  assert.deepEqual(parseCspReports("not json", "application/csp-report"), []);
  assert.deepEqual(parseCspReports("x".repeat(70_000), "application/csp-report"), []);
  assert.deepEqual(parseCspReports(JSON.stringify({ "csp-report": { "violated-directive": "img-src" } }), ""), []); // no page
});

test("blockedOf keeps keywords and schemes, pageOf collapses tool args", () => {
  assert.equal(blockedOf("inline"), "inline");
  assert.equal(blockedOf("eval"), "eval");
  assert.equal(blockedOf("data:image/png;base64,AAAA"), "data:");
  assert.equal(blockedOf("blob:https://x.app/uuid"), "blob:");
  assert.equal(blockedOf("wss://s.example/socket?x=1"), "wss://s.example");
  assert.equal(pageOf("https://x.app/tool/price/alerts"), "/tool/price/alerts");
  assert.equal(pageOf("https://x.app/tool/price/https%3A%2F%2Fshop"), "/tool/price");
  assert.equal(pageOf("https://x.app/sheaf/index.html"), "/sheaf");
  assert.equal(pageOf("https://x.app/robots.txt"), "/other");
});
