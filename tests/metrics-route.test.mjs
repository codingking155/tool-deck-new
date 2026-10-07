import test from "node:test";
import assert from "node:assert/strict";
import { metricsPath, scrubEvent } from "../src/lib/metricsRoute.js";
import { TOOLS } from "../src/toolsMeta.js";

const id = TOOLS[0].id;

test("metricsPath keeps the page or tool and drops everything after the tool id", () => {
  assert.equal(metricsPath("/"), "/");
  assert.equal(metricsPath(`/tool/${id}`), `/tool/${id}`);
  assert.equal(metricsPath(`/tool/${id}/`), `/tool/${id}`);
  assert.equal(metricsPath(`/tool/${id}/https%3A%2F%2Fexample.com%2Fp%3Fid%3D1`), `/tool/${id}`);
  assert.equal(metricsPath("/tool/price/alerts"), "/tool/price/alerts");
  assert.equal(metricsPath("/tool/not-a-tool/x"), "/not-found");
  assert.equal(metricsPath("/whatever"), "/not-found");
});

test("scrubEvent rewrites the URL, strips query and hash, drops unparseable events", () => {
  const e = scrubEvent({ type: "pageview", url: `https://x.app/tool/${id}/+919876543210?q=1#h` });
  assert.deepEqual(e, { type: "pageview", url: `https://x.app/tool/${id}` });
  assert.equal(scrubEvent({ url: "not a url" }), null);
});
