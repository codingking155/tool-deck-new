// Outbound fetch for user-supplied URLs.
//
// The previous implementation validated the hostname once and then called
// fetch with `redirect: "follow"`, so any cooperating server could 302 the
// request into private space. This wrapper walks redirects itself and
// re-validates every hop, resolves DNS and range-checks the answers (so a
// public name pointing at 10.x is refused), restricts ports, caps the response
// body, and enforces an overall deadline.
//
// Known residual risk: DNS can change between our check and the connect
// (rebinding). Closing that fully means connecting to a pinned IP with an
// explicit Host header, which platform fetch APIs do not expose. If you need
// that guarantee, put an egress allowlist in front of the function instead of
// relying on this module alone.

import { classifyHost, anyResolvedAddressBlocked } from "./ipGuard.mjs";

export class BlockedUrlError extends Error {
  constructor(reason, url) {
    super(`Blocked URL (${reason})`);
    this.name = "BlockedUrlError";
    this.reason = reason;
    this.url = url;
  }
}

/** Default resolver: Deno.resolveDns when present, node:dns otherwise, else no-op. */
async function defaultResolve(hostname) {
  const out = [];
  /* global Deno */
  if (typeof Deno !== "undefined" && Deno.resolveDns) {
    for (const type of ["A", "AAAA"]) {
      try {
        const r = await Deno.resolveDns(hostname, type);
        out.push(...r);
      } catch { /* NXDOMAIN for this record type */ }
    }
    return out;
  }
  try {
    // Computed specifier: keeps Deno's type checker (and bundlers) from trying
    // to resolve node builtins in environments where they don't exist.
    const spec = "node:" + "dns";
    const dns = await import(spec);
    const r = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return r.map((x) => x.address);
  } catch {
    return out; // resolution unavailable — caller decides via requireResolution
  }
}

/**
 * Validate one URL. Throws BlockedUrlError if it must not be fetched.
 * Exported so callers can pre-flight a URL without performing a request.
 */
export async function assertFetchable(url, opts = {}) {
  const {
    allowedPorts = [80, 443],
    allowedProtocols = ["http:", "https:"],
    resolve = defaultResolve,
    requireResolution = true,
    hostAllowlist = null, // optional Set/array of exact hostnames
  } = opts;

  let u;
  try {
    u = url instanceof URL ? url : new URL(url);
  } catch {
    throw new BlockedUrlError("unparseable-url", String(url));
  }

  if (!allowedProtocols.includes(u.protocol)) throw new BlockedUrlError("protocol-not-allowed", u.href);

  const port = u.port === "" ? (u.protocol === "https:" ? 443 : 80) : Number(u.port);
  if (!allowedPorts.includes(port)) throw new BlockedUrlError(`port-not-allowed:${port}`, u.href);

  // Strip the brackets the URL parser keeps on IPv6 literals.
  const host = u.hostname.replace(/^\[|\]$/g, "");

  if (hostAllowlist) {
    const set = hostAllowlist instanceof Set ? hostAllowlist : new Set(hostAllowlist);
    if (!set.has(host)) throw new BlockedUrlError("host-not-in-allowlist", u.href);
  }

  const cls = classifyHost(host);
  if (cls.blocked) throw new BlockedUrlError(`literal:${cls.reason}`, u.href);

  if (cls.kind === "name") {
    const addresses = await resolve(host);
    if (!addresses.length) {
      if (requireResolution) throw new BlockedUrlError("dns-no-answer", u.href);
    } else {
      const bad = anyResolvedAddressBlocked(addresses);
      if (bad) throw new BlockedUrlError(`resolved:${bad}`, u.href);
    }
  }

  return u;
}

/** Read a body stream up to maxBytes, aborting the transfer once exceeded. */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel(); } catch { /* already closed */ }
    return { text: "", truncated: true };
  }
  if (!res.body) return { text: await res.text().catch(() => ""), truncated: false };

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.length - (total - maxBytes)));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}

/**
 * Fetch a user-supplied URL safely.
 * @returns {{ok:boolean,status:number,finalUrl:string,headers:Headers,text:string,truncated:boolean,hops:string[]}}
 */
export async function safeFetch(rawUrl, opts = {}) {
  const {
    method = "GET",
    headers = {},
    maxRedirects = 3,
    timeoutMs = 12_000,
    maxBytes = 1_500_000,
    fetchImpl = fetch,
    ...guardOpts
  } = opts;

  const deadline = Date.now() + timeoutMs;
  const hops = [];
  let current = await assertFetchable(rawUrl, guardOpts);

  for (let i = 0; i <= maxRedirects; i++) {
    hops.push(current.href);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BlockedUrlError("timeout", current.href);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    let res;
    try {
      res = await fetchImpl(current.href, {
        method,
        headers,
        redirect: "manual", // we walk redirects ourselves so each hop is checked
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!isRedirect) {
      const { text, truncated } = await readCapped(res, maxBytes);
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: current.href,
        headers: res.headers,
        text,
        truncated,
        hops,
      };
    }

    // Drain the redirect body so the connection can be reused/closed cleanly.
    try { await res.body?.cancel(); } catch { /* no body */ }

    let next;
    try {
      next = new URL(res.headers.get("location"), current);
    } catch {
      throw new BlockedUrlError("bad-redirect-location", current.href);
    }
    // Re-validate. This is the check the old code skipped.
    current = await assertFetchable(next, guardOpts);
  }

  throw new BlockedUrlError("too-many-redirects", hops[hops.length - 1]);
}
