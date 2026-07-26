// Host classification for outbound fetches.
//
// The previous check regex-matched `^(\d+)\.(\d+)\.(\d+)\.(\d+)$` on the raw
// hostname, which let every non-dotted-quad spelling of loopback straight
// through: 127.1, 2130706433, 0177.0.0.1 and 0x7f.0.0.1 all parse back to
// 127.0.0.1 in the WHATWG URL parser (and therefore in fetch). This module
// parses the host the way the URL spec does, then range-checks the resulting
// address, so the spelling stops mattering.
//
// Pure and dependency-free so it runs identically in Deno, Node and the browser.

/* ─── IPv4 ─────────────────────────────────────────────────────────────────── */

// WHATWG allows decimal, octal (leading 0) and hex (leading 0x) parts, and
// fewer than four parts, where the final part absorbs the remaining octets.
function parsePart(s) {
  if (s === "") return null;
  let radix = 10;
  let body = s;
  if (/^0[xX]/.test(s)) {
    radix = 16;
    body = s.slice(2);
    if (body === "") return 0; // "0x" === 0
  } else if (s.length > 1 && s[0] === "0") {
    radix = 8;
    body = s.slice(1);
  }
  const ok = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
  if (!ok.test(body)) return null;
  const n = parseInt(body, radix);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse any URL-spec-legal IPv4 spelling to a uint32, or null if it isn't one. */
export function parseIpv4(host) {
  if (typeof host !== "string" || host === "") return null;
  const parts = host.split(".");
  // A single trailing dot is legal and ignored ("1.2.3.4.").
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 0 || parts.length > 4) return null;

  const nums = [];
  for (const p of parts) {
    const n = parsePart(p);
    if (n === null) return null;
    nums.push(n);
  }
  // Every part but the last must fit in one octet; the last absorbs the rest.
  for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 255) return null;
  const last = nums[nums.length - 1];
  if (last >= 256 ** (4 - (nums.length - 1))) return null;

  let addr = last;
  for (let i = 0; i < nums.length - 1; i++) addr += nums[i] * 256 ** (3 - i);
  return addr >>> 0;
}

export function ipv4ToString(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

// Everything that is not globally routable unicast. IANA special-purpose
// registry, plus the ranges that matter operationally.
const V4_BLOCKS = [
  ["0.0.0.0", 8, "this-network"],
  ["10.0.0.0", 8, "rfc1918-private"],
  ["100.64.0.0", 10, "cgnat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud-metadata"],
  ["172.16.0.0", 12, "rfc1918-private"],
  ["192.0.0.0", 24, "ietf-protocol-assignments"],
  ["192.0.2.0", 24, "test-net-1"],
  ["192.31.196.0", 24, "as112"],
  ["192.52.193.0", 24, "amt"],
  ["192.88.99.0", 24, "6to4-relay-anycast"],
  ["192.168.0.0", 16, "rfc1918-private"],
  ["198.18.0.0", 15, "benchmark"],
  ["198.51.100.0", 24, "test-net-2"],
  ["203.0.113.0", 24, "test-net-3"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

const V4_RANGES = V4_BLOCKS.map(([base, bits, label]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [(parseIpv4(base) & mask) >>> 0, mask, label];
});

/** @returns {string|null} the range label if reserved, else null. */
export function reservedIpv4Reason(addr) {
  for (const [net, mask, label] of V4_RANGES) {
    if (((addr & mask) >>> 0) === net) return label;
  }
  return null;
}

/* ─── IPv6 ─────────────────────────────────────────────────────────────────── */

/** Parse an IPv6 literal (with or without brackets) to 8 hextets, or null. */
export function parseIpv6(host) {
  if (typeof host !== "string") return null;
  let s = host.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone); // strip scope id

  // A trailing IPv4 literal (::ffff:127.0.0.1) becomes the last two hextets.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    s = s.slice(0, lastColon + 1) + ((v4 >>> 16) & 0xffff).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;

  let hextets;
  if (rest === null) {
    if (head.length !== 8) return null;
    hextets = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    hextets = [...head, ...Array(fill).fill("0"), ...rest];
  }

  const out = [];
  for (const h of hextets) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}

/** @returns {string|null} the range label if reserved, else null. */
export function reservedIpv6Reason(h) {
  if (!Array.isArray(h) || h.length !== 8) return null;
  const topFiveZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;

  if (h.every((x) => x === 0)) return "unspecified";
  if (topFiveZero && h[5] === 0 && h[6] === 0 && h[7] === 1) return "loopback";
  if (topFiveZero && h[5] === 0xffff) {
    // ::ffff:0:0/96 — IPv4-mapped. Range-check the embedded IPv4.
    const v4 = (((h[6] << 16) | h[7]) >>> 0);
    return reservedIpv4Reason(v4) ? `ipv4-mapped ${reservedIpv4Reason(v4)}` : null;
  }
  if (topFiveZero && h[5] === 0) return "ipv4-compatible-deprecated";
  if ((h[0] & 0xfe00) === 0xfc00) return "unique-local";
  if ((h[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((h[0] & 0xff00) === 0xff00) return "multicast";
  if (h[0] === 0x0064 && h[1] === 0xff9b) return "nat64";
  if (h[0] === 0x2001 && h[1] === 0x0000) return "teredo";
  if (h[0] === 0x2001 && h[1] === 0x0db8) return "documentation";
  if (h[0] === 0x2002) return "6to4";
  return null;
}

/* ─── Hostnames ────────────────────────────────────────────────────────── */

// Suffixes that never resolve to public unicast space.
const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|corp|home|home\.arpa|localdomain|onion|test|example|invalid)$/i;

/**
 * Classify a URL hostname without doing DNS.
 * @returns {{kind:'ipv4'|'ipv6'|'name', blocked:boolean, reason:string|null, addr?:number|number[]}}
 */
export function classifyHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return { kind: "name", blocked: true, reason: "empty-host" };

  const v6 = parseIpv6(host);
  if (v6) {
    const reason = reservedIpv6Reason(v6);
    return { kind: "ipv6", blocked: !!reason, reason, addr: v6 };
  }

  const v4 = parseIpv4(host);
  if (v4 !== null) {
    const reason = reservedIpv4Reason(v4);
    return { kind: "ipv4", blocked: !!reason, reason, addr: v4 };
  }

  if (BLOCKED_SUFFIX.test(host)) return { kind: "name", blocked: true, reason: "non-public-suffix" };
  // A bare label with no dot is an internal service name (`db`, `redis`), not a
  // site anyone can visit on the public web.
  if (!host.includes(".")) return { kind: "name", blocked: true, reason: "bare-hostname" };
  if (host.endsWith(".")) return { kind: "name", blocked: false, reason: null };
  return { kind: "name", blocked: false, reason: null };
}

/** True if any resolved address for a hostname lands in reserved space. */
export function anyResolvedAddressBlocked(addresses) {
  for (const a of addresses || []) {
    const c = classifyHost(a);
    if (c.blocked) return c.reason || "reserved-address";
  }
  return null;
}
