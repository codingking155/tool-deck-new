import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, promises as dnsPromises, type LookupAddress } from "node:dns";
import { DetectionError } from "./errors";

const blocked = new BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
const V6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (incl. fd00:ec2::254 metadata)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, "ipv6");

function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // ::ffff:a.b.c.d (mapped), 64:ff9b::a.b.c.d (NAT64), ::a.b.c.d (compat)
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    const lo = parseInt(sixToFour[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for any address a server-side fetch must never reach. Unknown formats are blocked. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4 && isIP(v4) === 4 && blocked.check(v4, "ipv4")) return true;
    return blocked.check(ip, "ipv6");
  }
  return true;
}

export type Resolver = (host: string) => Promise<LookupAddress[]>;

const defaultResolver: Resolver = (host) => dnsPromises.lookup(host, { all: true, verbatim: true });

/** Resolves a hostname up front so we can return a clean 400/422 before fetching. */
export async function assertPublicHost(host: string, resolve: Resolver = defaultResolver): Promise<void> {
  let addrs: LookupAddress[];
  try {
    addrs = await resolve(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_AGAIN" || code === "ESERVFAIL") {
      throw new DetectionError("unreachable", `We couldn't find ${host} — check the domain for typos.`, "dns");
    }
    throw new DetectionError("unreachable", `DNS lookup for ${host} failed.`, "dns");
  }
  if (!addrs.length) throw new DetectionError("unreachable", `${host} has no DNS records.`, "dns");
  if (addrs.some((a) => isBlockedIp(a.address))) {
    throw new DetectionError("invalid_url", "That domain points to a private or reserved network address.");
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Drop-in `lookup` for sockets. Runs at connect time, so every redirect hop and
 * any DNS-rebinding attempt is checked against the same block list.
 */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number } | undefined, callback: LookupCallback): void {
  dnsLookup(hostname, { family: options?.family ?? 0, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      const e: NodeJS.ErrnoException = new Error(`Refusing to connect to a private address for ${hostname}`);
      e.code = "EBLOCKEDADDR";
      return callback(e, "");
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}
