import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDomain, wildcardParent, nameCovers, parseDate, daysUntil, expirySeverity,
  selectLatestCert, issuerName, classifyTlsError,
} from "../shared/sslCore/index.mjs";

test("normalizeDomain strips scheme, credentials, port 443, path and trailing dot; punycodes IDNs", () => {
  for (const [input, host] of [
    ["https://Example.com:443/path?q=1#x", "example.com"],
    ["  example.com.  ", "example.com"],
    ["user:pw@sub.example.com/", "sub.example.com"],
    ["example.com:", "example.com"],
    ["bücher.de", "xn--bcher-kva.de"],
  ]) assert.deepEqual(normalizeDomain(input), { ok: true, host }, input);
});

test("normalizeDomain refuses IPs (any spelling), internal names, other ports and junk", () => {
  const code = (s) => normalizeDomain(s).code;
  for (const ip of ["1.2.3.4", "http://10.0.0.1/", "2130706433", "0x7f.1", "[::1]", "2001:db8::1"]) assert.equal(code(ip), "ip_address", ip);
  for (const h of ["localhost", "localhost.", "printer.local", "x.internal", "box.home.arpa"]) assert.equal(code(h), "private_host", h);
  assert.equal(code("example.com:8443"), "port");
  assert.equal(code(""), "empty");
  for (const j of ["foo", "-bad.com", "a..b.com", "exa mple.com", "example.c0m"]) assert.equal(code(j), "invalid", j);
});

test("wildcardParent / nameCovers: one label only, apex has no wildcard parent", () => {
  assert.equal(wildcardParent("a.example.com"), "*.example.com");
  assert.equal(wildcardParent("example.com"), null);
  assert.ok(nameCovers("*.example.com", "a.example.com"));
  assert.ok(nameCovers("EXAMPLE.com", "example.com"));
  assert.ok(!nameCovers("*.example.com", "example.com"));
  assert.ok(!nameCovers("*.example.com", "a.b.example.com"));
  assert.ok(!nameCovers("*.example.com", "aexample.com"));
});

test("parseDate treats crt.sh's zone-less times as UTC and never throws", () => {
  assert.equal(parseDate("2026-01-02T03:04:05"), Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(parseDate("2026-01-02T03:04:05Z"), Date.UTC(2026, 0, 2, 3, 4, 5));
  for (const bad of [null, undefined, "", "not a date", NaN, {}]) assert.equal(parseDate(bad), null);
});

test("daysUntil + expirySeverity", () => {
  const now = Date.UTC(2026, 9, 6);
  assert.equal(daysUntil(now + 10.5 * 86_400_000, now), 10);
  assert.equal(daysUntil(now - 1, now), -1);
  assert.equal(daysUntil(null, now), null);
  assert.equal(expirySeverity(-1).level, "expired");
  assert.equal(expirySeverity(3).level, "critical");
  assert.equal(expirySeverity(20).level, "warning");
  assert.equal(expirySeverity(60).level, "ok");
  assert.equal(expirySeverity(null).level, "unknown");
});

const NOW = Date.UTC(2026, 9, 6);
const row = (o) => ({ issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: "example.com", name_value: "example.com\nwww.example.com", ...o });

test("selectLatestCert picks the newest currently-valid cert that names the host", () => {
  const rows = [
    row({ id: 1, serial_number: "AA", not_before: "2026-07-01T00:00:00", not_after: "2026-09-29T00:00:00" }),   // expired
    row({ id: 2, serial_number: "BB", not_before: "2026-08-15T00:00:00", not_after: "2026-11-13T00:00:00" }),
    row({ id: 3, serial_number: "CC", not_before: "2026-09-20T00:00:00", not_after: "2026-12-19T00:00:00" }),   // newest
    row({ id: 4, serial_number: "DD", not_before: "2026-10-10T00:00:00", not_after: "2027-01-08T00:00:00" }),   // not valid yet
    row({ id: 5, serial_number: "EE", common_name: "other.org", name_value: "other.org", not_before: "2026-10-01T00:00:00", not_after: "2026-12-30T00:00:00" }),
    { junk: true }, null,
  ];
  const c = selectLatestCert(rows, "example.com", NOW);
  assert.equal(c.serial, "cc");
  assert.equal(c.crtshId, 3);
  assert.equal(c.issuer, "Let's Encrypt (R11)");
  assert.equal(c.notAfter, "2026-12-19T00:00:00.000Z");
  assert.deepEqual(c.sans, ["example.com", "www.example.com"]);
});

test("selectLatestCert: wildcard SANs cover subdomains; precert duplicates collapse; nothing → null", () => {
  const rows = [
    row({ id: 10, serial_number: "11", common_name: "*.example.com", name_value: "*.example.com\nexample.com", not_before: "2026-09-01T00:00:00", not_after: "2026-12-01T00:00:00" }),
    row({ id: 11, serial_number: "11", common_name: "*.example.com", name_value: "*.example.com\nexample.com", not_before: "2026-09-01T00:00:00", not_after: "2026-12-01T00:00:00" }),
  ];
  const c = selectLatestCert(rows, "shop.example.com", NOW);
  assert.equal(c.crtshId, 11);
  assert.equal(selectLatestCert(rows, "a.shop.example.com", NOW), null);
  assert.equal(selectLatestCert("nope", "example.com", NOW), null);
  assert.equal(selectLatestCert([], "example.com", NOW), null);
});

test("issuerName handles quoted DN values", () => {
  assert.equal(issuerName('C=US, O="DigiCert, Inc.", CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1'), "DigiCert, Inc. (DigiCert Global G2 TLS RSA SHA256 2020 CA1)");
  assert.equal(issuerName("CN=Solo"), "Solo");
  assert.equal(issuerName(null), null);
});

test("classifyTlsError maps runtime messages to honest statuses", () => {
  const s = (m) => classifyTlsError(m).status;
  assert.equal(s("invalid peer certificate: Expired"), "expired");
  assert.equal(s("invalid peer certificate contents: invalid peer certificate: CertExpired"), "expired");
  assert.equal(s("invalid peer certificate: NotValidForName"), "hostname_mismatch");
  assert.equal(s("invalid peer certificate: UnknownIssuer"), "untrusted");
  assert.equal(s("invalid peer certificate: NotValidYet"), "not_yet_valid");
  assert.equal(s("Connection refused (os error 111)"), "unreachable");
  assert.equal(s("timed out"), "unreachable");
  assert.equal(s("received fatal alert: HandshakeFailure"), "handshake_failed");
  assert.equal(s("???"), "error");
});

test("classifyTlsError: connection-closed handshake failures aren't reported as unreachable", async () => {
  const { classifyTlsError } = await import("../shared/sslCore/index.mjs");
  assert.equal(classifyTlsError("peer closed connection without sending TLS close_notify").status, "handshake_failed");
  assert.equal(classifyTlsError("connection closed during handshake").status, "handshake_failed");
  assert.equal(classifyTlsError("Connection refused (os error 111)").status, "unreachable");
  assert.equal(classifyTlsError("connection timed out").status, "unreachable");
});
