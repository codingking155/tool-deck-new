/* Pure helpers for My IP & IPv6 Test (no DOM, unit-tested in tests/ip-info.test.mjs):
   user-agent parsing, IPv6 address classification, on-screen masking and the copyable report. */

/* ── user agent ────────────────────────────────────────────────────────── */

/** touchPoints = navigator.maxTouchPoints. iPadOS 13+ asks for desktop sites with a Mac UA,
    and a touch screen is the only reliable tell (no Mac has one). */
export function parseUA(ua = "", touchPoints = 0) {
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const browser = /OPR\/|OPT\/|Opera/.test(ua) ? "Opera"
    : /Edg(?:A|iOS)?\//.test(ua) ? "Edge"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Unknown";
  const os = /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : ipad ? "iPadOS"
    : /iPhone|iPod/.test(ua) ? "iOS"
    : /Mac OS/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux" : "Unknown";
  /* Android tablets drop "Mobile" from the UA */
  const device = ipad || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "Tablet" : /Mobi|iPhone|iPod/.test(ua) ? "Mobile" : "Desktop";
  return { browser, os, device };
}

/* ── IPv6 ──────────────────────────────────────────────────────────────── */

/** "2001:db8::1" → eight 16-bit numbers, or null if it isn't an IPv6 address. Accepts a zone
    (%eth0), brackets and a trailing dotted IPv4 (::ffff:1.2.3.4). */
export function expandIpv6(addr) {
  let a = String(addr ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!a.includes(":")) return null;
  const dotted = a.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const o = dotted.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    a = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...head, ...tail].some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  return [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((h) => parseInt(h, 16));
}

const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * → { kind, label, note, embeddedV4? } or null for a non-IPv6 string.
 * The interface-ID verdicts for global addresses are honest about their limits: a temporary
 * (RFC 8981) address and a stable-privacy (RFC 7217) one are both random-looking and can't be
 * told apart from a single sample. Only EUI-64 (ff:fe in the middle) is a certain tell.
 */
export function classifyIpv6(addr) {
  const h = expandIpv6(addr);
  if (!h) return null;
  const zeroUpTo = (n) => h.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return { kind: "unspecified", label: "Unspecified", note: "The all-zero address (::) means “no address”." };
  if (zeroUpTo(7) && h[7] === 1) return { kind: "loopback", label: "Loopback", note: "::1 is this device talking to itself." };
  if (zeroUpTo(5) && h[5] === 0xffff) return { kind: "mapped", label: "IPv4-mapped", note: "An IPv4 address written in IPv6 form (::ffff:0:0/96); the connection is really IPv4.", embeddedV4: v4of(h[6], h[7]) };
  if (h[0] === 0x64 && h[1] === 0xff9b && (h[2] === 1 || (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0))) {
    /* well-known 64:ff9b::/96 carries the IPv4 in the last 32 bits; local-use 64:ff9b:1::/48 places it by prefix length */
    const wk = h[2] === 0;
    return { kind: "nat64", label: "NAT64", note: "A NAT64 address (64:ff9b::/96 or 64:ff9b:1::/48): an IPv4 address reached through an IPv6-to-IPv4 translator on the network.", ...(wk && { embeddedV4: v4of(h[6], h[7]) }) };
  }
  if (h[0] >> 8 === 0xff) return { kind: "multicast", label: "Multicast", note: "A multicast group address (ff00::/8), not a device address." };
  if ((h[0] & 0xffc0) === 0xfe80) return { kind: "linklocal", label: "Link-local", note: "Only valid on the local link (fe80::/10). Every IPv6 device has one; it can't be reached from the internet." };
  if ((h[0] & 0xfe00) === 0xfc00) return { kind: "ula", label: "Unique local (private)", note: "A private address (fc00::/7), the IPv6 counterpart of 192.168.x.x. Not reachable from the internet." };
  if ((h[0] === 0x2001 && h[1] === 0x0db8) || (h[0] === 0x3fff && h[1] >> 12 === 0)) {
    return { kind: "documentation", label: "Documentation example", note: "Reserved for examples in documentation (2001:db8::/32, 3fff::/20); it never appears on the real internet." };
  }
  if (h[0] === 0x2001 && h[1] === 0) {
    return { kind: "teredo", label: "Teredo tunnel", note: "Teredo (2001::/32) tunnels IPv6 over IPv4 UDP through a relay. It's a fallback, not native IPv6, and is often slow or blocked.", embeddedV4: v4of(h[6] ^ 0xffff, h[7] ^ 0xffff) };
  }
  if (h[0] === 0x2002) return { kind: "6to4", label: "6to4 tunnel", note: "6to4 (2002::/16) wraps an IPv4 address in IPv6. It's deprecated and often unreliable — native IPv6 from your ISP is better.", embeddedV4: v4of(h[1], h[2]) };
  if ((h[0] & 0xe000) !== 0x2000) return { kind: "reserved", label: "Reserved", note: "Outside the global unicast range (2000::/3)." };

  /* global unicast: judge the interface ID (last 64 bits) */
  if ((h[5] & 0xff) === 0xff && h[6] >> 8 === 0xfe) {
    return { kind: "eui64", label: "Stable · from hardware", note: "The last half is built from your network adapter's MAC address (EUI-64), so it stays the same on every network and can identify this device. Turning on IPv6 privacy extensions avoids that." };
  }
  if (h[4] === 0 && h[5] === 0 && h[6] === 0) {
    return { kind: "static", label: "Looks static", note: "The host part is small and hand-picked (like ::1 or ::a), typical of a manually set or DHCPv6-assigned address. Usually stable." };
  }
  return { kind: "random", label: "Randomised host part", note: "The last half looks random, as privacy addresses do. It may be a temporary address that rotates (often daily) or a stable-privacy one fixed per network — from outside they look the same." };
}

/* ── masking (screen sharing) ──────────────────────────────────────────── */

/** On-screen only: keeps the network part, hides the host. 203.0.113.9 → 203.0.113.x,
    2401:4900:1c5b:aa::1 → 2401:4900:1c5b:…. Non-addresses (e.g. mDNS .local names) pass through. */
export function maskAddress(ip) {
  if (!ip) return ip;
  const s = String(ip);
  const v4 = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x`;
  const h = expandIpv6(s);
  if (!h) return s;
  return `${h.slice(0, 3).map((x) => x.toString(16)).join(":")}:…`;
}

/* ── copyable report ───────────────────────────────────────────────────── */

/**
 * Plain text for a support ticket. Always the real addresses: copying is an explicit act.
 * webrtc: { title, publicIps?, localIps? } · dns: { title, networks?, count? } — either may be null (not run).
 */
export function buildIpReport({ v4, v6, geo, localTz, ua, webrtc, dns, at } = {}) {
  const na = "Unavailable";
  const v6c = v6 ? classifyIpv6(v6) : null;
  const lines = [
    "ToolDeck — My IP & IPv6 Test report",
    at ? `Generated: ${at}` : null,
    "",
    `IPv4: ${v4 || "Not detected"}`,
    `IPv6: ${v6 ? `${v6}${v6c ? ` (${v6c.label})` : ""}` : "Not available on this connection"}`,
    `ISP / network: ${geo && (geo.org || geo.asn) ? [geo.org, geo.asn].filter(Boolean).join(" · ") : na}`,
    `Approx. location: ${(geo && [geo.city, geo.region, geo.country].filter(Boolean).join(", ")) || na}`,
    `IP time zone: ${geo?.tz || na}`,
    localTz ? `Device time zone: ${localTz}` : null,
    ua ? `Browser: ${ua.browser} on ${ua.os} (${ua.device})` : null,
    "",
    `WebRTC leak check: ${webrtc?.title || "Not run"}`,
    webrtc?.publicIps?.length ? `  Public addresses seen: ${webrtc.publicIps.join(", ")}` : null,
    webrtc?.localIps?.length ? `  Local addresses exposed: ${webrtc.localIps.join(", ")}` : null,
    `DNS leak check: ${dns?.title || "Not run"}`,
    dns?.count ? `  DNS servers: ${dns.count}${dns.networks ? ` (${dns.networks})` : ""}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}
