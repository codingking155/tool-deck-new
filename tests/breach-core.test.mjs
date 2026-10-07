import test from "node:test";
import assert from "node:assert/strict";
import { isValidEmail, sha1Hex, pwnedCount, parseXonAnalytics, isXonNotFound, summarize } from "../shared/breachCore/index.mjs";

test("email validation", () => {
  assert.ok(isValidEmail("a@b.co"));
  assert.ok(!isValidEmail("a@b"));
  assert.ok(!isValidEmail("a b@c.com"));
  assert.ok(!isValidEmail("x".repeat(250) + "@a.com"));
});

test("sha1 of 'password' is the well-known hash", async () => {
  assert.equal(await sha1Hex("password"), "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
});

test("pwnedCount finds suffix, ignores padding and case", () => {
  const body = "0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0";
  assert.equal(pwnedCount(body, "1e4c9b93f3f0682250b6cf8331b7ee68fd8"), 9545824);
  assert.equal(pwnedCount(body, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"), 0);
  assert.equal(pwnedCount(body, "ABCDEF"), 0);
});

const sample = {
  ExposedBreaches: { breaches_details: [
    { breach: "OldSite", domain: "old.com", xposed_date: "2012", xposed_records: 1000, xposed_data: "Email addresses;Passwords", details: "<b>Leak</b> of users", verified: "Yes" },
    { breach: "NewSite", domain: "", xposed_date: "2021", xposed_records: "abc", xposed_data: "Email addresses;Names", verified: "No" },
  ] },
};

test("parseXonAnalytics normalises, sorts newest first, flags severity", () => {
  const b = parseXonAnalytics(sample);
  assert.deepEqual(b.map((x) => x.name), ["NewSite", "OldSite"]);
  assert.equal(b[0].records, null);
  assert.equal(b[0].severe, false);
  assert.equal(b[1].severe, true);
  assert.equal(b[1].description, "Leak of users");
  assert.deepEqual(summarize(b), { count: 2, severe: true, dataTypes: ["Email addresses", "Names", "Passwords"] });
});

test("a missing record count is unknown, not zero", () => {
  for (const xposed_records of [null, ""]) {
    const [b] = parseXonAnalytics({ ExposedBreaches: { breaches_details: [{ breach: "X", xposed_records }] } });
    assert.equal(b.records, null);
  }
});

test("unrecognised payload is null, never an empty 'clear' list", () => {
  assert.equal(parseXonAnalytics({}), null);
  assert.equal(parseXonAnalytics(null), null);
  assert.equal(parseXonAnalytics({ ExposedBreaches: null }), null);
  // Current XON "clean address" reply: 200 with null breaches + an empty summary.
  assert.deepEqual(parseXonAnalytics({
    BreachesSummary: { domain: "", site: "", tmpstmp: "" }, PastesSummary: { cnt: 0, domain: "", tmpstmp: "" },
    ExposedBreaches: null, ExposedPastes: null, BreachMetrics: null, PasteMetrics: null,
  }), []);
  assert.equal(parseXonAnalytics({ BreachesSummary: {}, ExposedBreaches: {} }), null);
});

test("only a genuine 404 'Not found' means clean", () => {
  assert.ok(isXonNotFound(404, { Error: "Not found" }));
  assert.ok(isXonNotFound(404, { detail: "Not found" }));
  assert.ok(!isXonNotFound(404, { detail: "Breach not found" }));
  assert.ok(!isXonNotFound(404, {}));
  assert.ok(!isXonNotFound(500, { Error: "Not found" }));
});
