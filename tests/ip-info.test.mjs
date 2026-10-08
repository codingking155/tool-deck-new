import test from "node:test";
import assert from "node:assert/strict";
import { parseUA, expandIpv6, classifyIpv6, maskAddress, buildIpReport } from "../src/lib/ipInfo.js";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  operaWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
  operaAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 OPR/84.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  oldIpad: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

test("parseUA: browsers, including Opera (which also says Chrome)", () => {
  assert.equal(parseUA(UA.chromeWin).browser, "Chrome");
  assert.equal(parseUA(UA.edgeWin).browser, "Edge");
  assert.equal(parseUA(UA.operaWin).browser, "Opera");
  assert.equal(parseUA(UA.operaAndroid).browser, "Opera");
  assert.equal(parseUA(UA.safariMac).browser, "Safari");
  assert.equal(parseUA(UA.chromeIphone).browser, "Chrome");
  assert.equal(parseUA(UA.firefoxLinux).browser, "Firefox");
  assert.equal(parseUA("").browser, "Unknown");
});

test("parseUA: iPadOS sending a Mac UA is told apart by touch points", () => {
  assert.deepEqual(parseUA(UA.safariMac, 0), { browser: "Safari", os: "macOS", device: "Desktop" });
  assert.deepEqual(parseUA(UA.safariMac, 5), { browser: "Safari", os: "iPadOS", device: "Tablet" });
  assert.deepEqual(parseUA(UA.oldIpad, 5), { browser: "Safari", os: "iPadOS", device: "Tablet" });
  assert.deepEqual(parseUA(UA.iphone, 5), { browser: "Safari", os: "iOS", device: "Mobile" });
});

test("parseUA: Android phones vs tablets, desktop OSes", () => {
  assert.equal(parseUA(UA.operaAndroid).device, "Mobile");
  assert.deepEqual([parseUA(UA.androidTablet).os, parseUA(UA.androidTablet).device], ["Android", "Tablet"]);
  assert.deepEqual([parseUA(UA.chromeWin).os, parseUA(UA.chromeWin).device], ["Windows", "Desktop"]);
  assert.equal(parseUA(UA.firefoxLinux).os, "Linux");
});

test("expandIpv6 handles compression, zones, brackets and dotted tails; rejects junk", () => {
  assert.deepEqual(expandIpv6("2001:db8::1"), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(expandIpv6("::"), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(expandIpv6("[fe80::1%eth0]"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(expandIpv6("::ffff:192.0.2.1"), [0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201]);
  assert.deepEqual(expandIpv6("1:2:3:4:5:6:7:8"), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const bad of ["1.2.3.4", "1::2::3", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "12345::", "g::1", "::1.2.3.256", "", null]) {
    assert.equal(expandIpv6(bad), null, String(bad));
  }
});

test("classifyIpv6: special ranges", () => {
  const kind = (a) => classifyIpv6(a)?.kind;
  assert.equal(kind("::1"), "loopback");
  assert.equal(kind("::"), "unspecified");
  assert.equal(kind("fe80::1c2a:3bff:fe4d:5e6f"), "linklocal");
  assert.equal(kind("fd12:3456:789a::1"), "ula");
  assert.equal(kind("fc00::1"), "ula");
  assert.equal(kind("2001:db8:85a3::8a2e:370:7334"), "documentation");
  assert.equal(kind("3fff:0abc::1"), "documentation");
  assert.equal(kind("ff02::1"), "multicast");
  assert.equal(kind("::ffff:198.51.100.7"), "mapped");
  assert.equal(kind("1.2.3.4"), undefined);
});

test("classifyIpv6: transition mechanisms decode the IPv4 inside", () => {
  const sixToFour = classifyIpv6("2002:cb00:7109::1");
  assert.deepEqual([sixToFour.kind, sixToFour.embeddedV4], ["6to4", "203.0.113.9"]);
  // Teredo: client IPv4 is the last 32 bits, bit-inverted
  const teredo = classifyIpv6("2001:0:4136:e378:8000:63bf:3fff:fdd2");
  assert.deepEqual([teredo.kind, teredo.embeddedV4], ["teredo", "192.0.2.45"]);
  const nat64 = classifyIpv6("64:ff9b::c000:221");
  assert.deepEqual([nat64.kind, nat64.embeddedV4], ["nat64", "192.0.2.33"]);
  assert.equal(classifyIpv6("64:ff9b:1:abcd::1").kind, "nat64");
  assert.equal(classifyIpv6("64:ff9b:1:abcd::1").embeddedV4, undefined);
  assert.equal(classifyIpv6("64:ff9b:2::1").kind, "reserved");
});

test("classifyIpv6: global interface IDs — only EUI-64 is certain; random is worded as ambiguous", () => {
  assert.equal(classifyIpv6("2405:201:abcd:12::1").kind, "static");
  assert.equal(classifyIpv6("2405:201:abcd:12::a").kind, "static");
  assert.equal(classifyIpv6("2405:201:abcd:12:021a:2bff:fe3c:4d5e").kind, "eui64");
  const r = classifyIpv6("2405:201:abcd:12:8d3f:6a21:c4e9:1b07");
  assert.equal(r.kind, "random");
  assert.match(r.note, /look the same/);   // never claims "temporary" outright
  assert.doesNotMatch(r.label, /temporary/i);
});

test("maskAddress hides the host part, keeps non-addresses", () => {
  assert.equal(maskAddress("103.186.40.202"), "103.186.40.x");
  assert.equal(maskAddress("2401:4900:1c5b:aa::1"), "2401:4900:1c5b:…");
  assert.equal(maskAddress("2001:db8::1"), "2001:db8:0:…");
  assert.equal(maskAddress("abcd-1234.local"), "abcd-1234.local");
  assert.equal(maskAddress(null), null);
});

test("buildIpReport: real values, readable when things are missing", () => {
  const full = buildIpReport({
    v4: "203.0.113.9", v6: "2405:201:abcd:12::1",
    geo: { org: "Reliance Jio", asn: "AS55836", city: "Mumbai", region: "Maharashtra", country: "India", tz: "Asia/Kolkata" },
    localTz: "Asia/Kolkata", ua: { browser: "Opera", os: "Windows", device: "Desktop" },
    webrtc: { title: "No WebRTC leak found", publicIps: ["203.0.113.9"], localIps: [] },
    dns: { title: "You're using Cloudflare", count: 3, networks: "Cloudflare" },
    at: "2026-10-07T10:00:00.000Z",
  });
  for (const line of [
    "IPv4: 203.0.113.9", "IPv6: 2405:201:abcd:12::1 (Looks static)", "ISP / network: Reliance Jio · AS55836",
    "Approx. location: Mumbai, Maharashtra, India", "IP time zone: Asia/Kolkata", "Browser: Opera on Windows (Desktop)",
    "WebRTC leak check: No WebRTC leak found", "  Public addresses seen: 203.0.113.9", "DNS leak check: You're using Cloudflare",
    "  DNS servers: 3 (Cloudflare)", "Generated: 2026-10-07T10:00:00.000Z",
  ]) assert.ok(full.split("\n").includes(line), line);
  assert.doesNotMatch(full, /Local addresses exposed/);

  const bare = buildIpReport({ v4: "203.0.113.9" });
  assert.match(bare, /IPv6: Not available on this connection/);
  assert.match(bare, /ISP \/ network: Unavailable/);
  assert.match(bare, /WebRTC leak check: Not run/);
  assert.match(bare, /DNS leak check: Not run/);
  assert.doesNotMatch(bare, /undefined|null/);
});
