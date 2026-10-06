import test from "node:test";
import assert from "node:assert/strict";
import { classifyAddress, parseCandidate, webrtcVerdict, parseDnsLeak, dnsSummary, runDnsLeakTest } from "../src/lib/leak.js";

test("classifyAddress", () => {
  const c = classifyAddress;
  assert.deepEqual(["192.168.1.5", "10.0.0.2", "172.20.1.1", "100.64.0.9"].map(c), ["private", "private", "private", "private"]);
  assert.deepEqual(["172.15.0.1", "172.32.0.1", "8.8.8.8", "100.128.0.1"].map(c), ["public", "public", "public", "public"]);
  assert.deepEqual(["169.254.3.4", "127.0.0.1"].map(c), ["linklocal", "loopback"]);
  assert.deepEqual(["fd12::1", "fe80::1", "::1", "2405:201::1", "abc-123.local"].map(c), ["private", "linklocal", "loopback", "public", "mdns"]);
  assert.equal(c("not an ip"), "unknown");
});

test("parseCandidate reads host, srflx and mDNS candidates; ignores junk", () => {
  const host = parseCandidate("candidate:842163049 1 udp 1677729535 192.168.1.20 46154 typ host generation 0");
  assert.deepEqual([host.address, host.type, host.kind, host.protocol, host.port], ["192.168.1.20", "host", "private", "udp", 46154]);
  const srflx = parseCandidate("a=candidate:1 1 UDP 1686052607 203.0.113.9 9 typ srflx raddr 0.0.0.0 rport 0");
  assert.deepEqual([srflx.address, srflx.type, srflx.kind], ["203.0.113.9", "srflx", "public"]);
  assert.equal(parseCandidate("candidate:2 1 udp 2113937151 7d3a-1.local 5000 typ host").kind, "mdns");
  assert.equal(parseCandidate("garbage"), null);
  assert.equal(parseCandidate(""), null);
});

const cs = (...lines) => lines.map(parseCandidate);

test("webrtcVerdict: ok when only mDNS + the site-visible public IP appear", () => {
  const v = webrtcVerdict(cs("candidate:1 1 udp 1 x-1.local 1 typ host", "candidate:2 1 udp 1 203.0.113.9 9 typ srflx"), { v4: "203.0.113.9" });
  assert.equal(v.level, "ok"); assert.equal(v.mdnsCount, 1);
});

test("webrtcVerdict: local when a private LAN address is exposed", () => {
  const v = webrtcVerdict(cs("candidate:1 1 udp 1 192.168.1.20 1 typ host", "candidate:2 1 udp 1 203.0.113.9 9 typ srflx"), { v4: "203.0.113.9" });
  assert.equal(v.level, "local"); assert.deepEqual(v.localIps, ["192.168.1.20"]);
});

test("webrtcVerdict: leak when WebRTC reveals a public IP different from what sites see (e.g. VPN bypass)", () => {
  const v = webrtcVerdict(cs("candidate:2 1 udp 1 198.51.100.7 9 typ srflx"), { v4: "203.0.113.9" });
  assert.equal(v.level, "leak"); assert.deepEqual(v.mismatched, ["198.51.100.7"]);
});

test("webrtcVerdict: IPv6 compared against IPv6; unknown known-address never flags; empty = blocked", () => {
  const six = webrtcVerdict(cs("candidate:2 1 udp 1 2405:201::1 9 typ srflx"), { v4: "203.0.113.9", v6: "2405:201::1" });
  assert.equal(six.level, "ok");
  assert.equal(webrtcVerdict(cs("candidate:2 1 udp 1 198.51.100.7 9 typ srflx"), {}).level, "ok");
  assert.equal(webrtcVerdict([], { v4: "1.1.1.1" }).level, "blocked");
});

test("parseDnsLeak extracts resolvers and the provider's conclusion; rejects unknown shapes", () => {
  const p = parseDnsLeak([
    { type: "ip", ip: "203.0.113.9", country_name: "India", asn: "AS1" },
    { type: "dns", ip: "74.125.1.1", country_name: "United States", asn: "AS15169 Google" },
    { type: "dns", ip: "1.1.1.1", country_name: "Australia", asn: "AS13335 Cloudflare" },
    { type: "conclusion", ip: "DNS may be leaking." },
  ]);
  assert.equal(p.resolvers.length, 2); assert.equal(p.conclusion, "DNS may be leaking.");
  assert.deepEqual(dnsSummary(p.resolvers), { count: 2, networks: 2, countries: 2 });
  assert.equal(parseDnsLeak({}), null);
  assert.deepEqual(parseDnsLeak([]).resolvers, []);
});

test("runDnsLeakTest follows id -> probes -> result and rejects bad ids", async () => {
  const calls = [];
  const ok = async (url) => {
    calls.push(url);
    if (url.endsWith("/id")) return { ok: true, text: async () => "abcdef1234567890\n" };
    if (url.includes("/dnsleak/test/")) return { ok: true, json: async () => [{ type: "dns", ip: "9.9.9.9", country_name: "US", asn: "AS19281" }] };
    return { ok: true };
  };
  const r = await runDnsLeakTest(ok, { probes: 3, settleMs: 0 });
  assert.equal(r.resolvers[0].ip, "9.9.9.9");
  assert.equal(calls.filter((u) => /^https:\/\/\d\.abcdef1234567890\.bash\.ws\/$/.test(u)).length, 3);
  const bad = async (url) => (url.endsWith("/id") ? { ok: true, text: async () => "<html>nope</html>" } : { ok: true });
  await assert.rejects(runDnsLeakTest(bad, { settleMs: 0 }), /unexpected response/);
  const down = async () => ({ ok: false });
  await assert.rejects(runDnsLeakTest(down, { settleMs: 0 }), /unavailable/);
});
