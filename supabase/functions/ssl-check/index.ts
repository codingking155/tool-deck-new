import { preflight, json, fail, log, withCors } from "../_shared/http.ts";
import { clientIp } from "../_shared/ratelimit.ts";
import { sharedRateLimit } from "../_shared/sharedRateLimit.ts";
import { anyResolvedAddressBlocked } from "../../../shared/net/ipGuard.mjs";
import { safeFetch } from "../../../shared/net/safeFetch.mjs";
import { normalizeDomain, wildcardParent, selectLatestCert, classifyTlsError } from "../../../shared/sslCore/index.mjs";

// GET /ssl-check?host=example.com
//   200 { host, checked_at,
//         tls: { status: "valid"|"expired"|"not_yet_valid"|"hostname_mismatch"|"untrusted"|"revoked"|
//                        "unreachable"|"handshake_failed"|"error", ok, message, ms },
//         ct:  { status: "found"|"none"|"unavailable", source: "crt.sh", certificate: {...} | null } }
//
// - tls: a real handshake to host:443, verified against the runtime's trust store.
//   Success means the served chain is trusted, unexpired and issued for this name.
// - ct: details of the most recently issued, currently valid certificate for the
//   name in Certificate Transparency logs (crt.sh). That is usually — not always —
//   the one the server presents; the UI says so.
// - The host is validated (no IPs, no internal names) and every resolved address is
//   range-checked; the TCP connection goes to that checked address (SNI = host), so
//   DNS rebinding can't point the probe at private space.
// - 20 checks/min per IP, shared across instances.

const CONNECT_MS = 5_000;
const HANDSHAKE_MS = 6_000;
const CT_MS = 10_000;

/** Reject after `ms`; if the operation settles later, hand its value to `late` (to close sockets). */
function withTimeout<T>(p: Promise<T>, ms: number, late?: (v: T) => void): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      p.then((v) => late?.(v)).catch(() => {});
      reject(new Error("timed out"));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function resolveAll(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try { out.push(...(await Deno.resolveDns(host, type))); } catch { /* no record of this type */ }
  }
  return out;
}

const closeQuietly = (c: { close(): void }) => { try { c.close(); } catch { /* already closed */ } };

async function probeTls(host: string, addr: string) {
  const t0 = performance.now();
  let conn: Deno.Conn | null = null;
  let tls: Deno.TlsConn | null = null;
  try {
    // TCP to the address we already range-checked, then TLS with SNI + name check against `host`.
    if (typeof Deno.startTls === "function") {
      conn = await withTimeout(Deno.connect({ hostname: addr, port: 443 }), CONNECT_MS, closeQuietly);
      tls = await withTimeout(Deno.startTls(conn, { hostname: host }), HANDSHAKE_MS, closeQuietly);
    } else {
      // Runtime without startTls: names were range-checked just above (small rebinding window).
      tls = await withTimeout(Deno.connectTls({ hostname: host, port: 443 }), CONNECT_MS + HANDSHAKE_MS, closeQuietly);
    }
    await withTimeout(tls.handshake(), HANDSHAKE_MS);
    return { ok: true, status: "valid", message: "The server presented a trusted, currently valid certificate for this name.", ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    const c = classifyTlsError(raw);
    log("ssl_tls_error", { host, status: c.status, raw: raw.slice(0, 200) });
    return { ok: false, ...c, ms: Math.round(performance.now() - t0) };
  } finally {
    if (tls) closeQuietly(tls); else if (conn) closeQuietly(conn);
  }
}

async function ctRecords(q: string): Promise<unknown[] | null> {
  const url = `https://crt.sh/?q=${encodeURIComponent(q)}&output=json&exclude=expired&deduplicate=Y`;
  const r = await safeFetch(url, {
    timeoutMs: CT_MS, maxBytes: 8_000_000, maxRedirects: 1, hostAllowlist: ["crt.sh"],
    headers: { "User-Agent": "ToolDeck-ssl-check/1.0 (+https://tooldeck.in/tool/ssl)", Accept: "application/json" },
  });
  if (!r.ok || r.truncated) throw new Error(`crt.sh ${r.status}${r.truncated ? " truncated" : ""}`);
  const text = r.text.trim();
  if (!text) return [];
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : null;
}

async function lookupCt(host: string) {
  const queries = [host, wildcardParent(host)].filter(Boolean) as string[];
  const results = await Promise.allSettled(queries.map(ctRecords));
  const rows = results.flatMap((r) => (r.status === "fulfilled" && r.value ? r.value : []));
  const anyAnswered = results.some((r) => r.status === "fulfilled" && r.value);
  const certificate = selectLatestCert(rows, host);
  if (certificate) return { status: "found", source: "crt.sh", certificate };
  if (!anyAnswered) {
    log("ssl_ct_unavailable", { host, reasons: results.map((r) => (r.status === "rejected" ? String(r.reason?.message ?? r.reason).slice(0, 80) : "bad-shape")) });
    return { status: "unavailable", source: "crt.sh", certificate: null };
  }
  return { status: "none", source: "crt.sh", certificate: null };
}

Deno.serve(withCors(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "GET") return fail(405, "method_not_allowed", "Use GET with ?host=");

  const rl = await sharedRateLimit("ssl", clientIp(req), 20, 60);
  if (!rl.ok) return json({ error: { code: "rate_limited", message: `Too many checks — try again in ${rl.retryAfter}s.` } }, 429, { "Retry-After": String(rl.retryAfter) });

  const n = normalizeDomain(new URL(req.url).searchParams.get("host") ?? "");
  if (!n.ok) return fail(400, n.code, n.message);
  const host = n.host;

  const addrs = await resolveAll(host);
  if (!addrs.length) return fail(400, "unresolvable_host", "That domain doesn't resolve. Check the spelling.");
  if (anyResolvedAddressBlocked(addrs)) return fail(400, "blocked_host", "That domain points to a private or internal address and can't be checked.");
  const addr = addrs.find((a) => !a.includes(":")) ?? addrs[0];

  const t0 = performance.now();
  const [tls, ct] = await Promise.all([probeTls(host, addr), lookupCt(host)]);
  log("ssl_check", { host, tls: tls.status, ct: ct.status, ms: Math.round(performance.now() - t0) });
  return json({ host, checked_at: new Date().toISOString(), tls, ct }, 200, { "Cache-Control": "no-store" });
}));
