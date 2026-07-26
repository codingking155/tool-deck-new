import { preflight, json, fail, CORS, log } from "../_shared/http.ts";

// Speed-test endpoints: ?op=ping | down&bytes=N | up | meta
// Security posture:
//  - down capped at 50 MB per request; up capped at 50 MB and DISCARDED unread-to-disk
//  - per-IP token bucket (60 req/min) — enough for a full test, hostile loops throttled
//  - CORS restricted via ALLOWED_ORIGIN (see _shared/http.ts)
//  - meta: IP processed transiently for the lookup response only; never logged in full

const MAX_DOWN = 50 * 1024 * 1024;
const MAX_UP = 50 * 1024 * 1024;

const buckets = new Map<string, { n: number; at: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { n: 0, at: now };
  if (now - b.at > 60_000) { b.n = 0; b.at = now; }
  b.n++;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value!);
  return b.n > 60;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || "unknown";
}

// 64 KB of random bytes, repeated — incompressible enough to defeat transparent
// compression, cheap enough to stream without allocating the full payload.
const CHUNK = crypto.getRandomValues(new Uint8Array(64 * 1024));

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const url = new URL(req.url);
  const op = url.searchParams.get("op") ?? "";
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "rate_limited", "Too many requests — try again in a minute.");

  if (op === "ping") {
    return new Response(null, { status: 204, headers: { ...CORS, "Cache-Control": "no-store" } });
  }

  if (op === "down") {
    if (req.method !== "GET") return fail(405, "method_not_allowed", "GET only.");
    const bytes = Math.min(Math.max(Number(url.searchParams.get("bytes") ?? 0) || 0, 0), MAX_DOWN);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= bytes) { controller.close(); return; }
        const n = Math.min(CHUNK.length, bytes - sent);
        controller.enqueue(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n));
        sent += n;
      },
    });
    return new Response(stream, {
      headers: {
        ...CORS, "Content-Type": "application/octet-stream", "Content-Length": String(bytes),
        "Cache-Control": "no-store, no-transform", "Content-Encoding": "identity",
      },
    });
  }

  if (op === "up") {
    if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
    const t0 = performance.now();
    let received = 0;
    const reader = req.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;             // counted, then dropped — never stored
        if (received > MAX_UP) { try { await reader.cancel(); } catch { /* closed */ } return fail(413, "too_large", "Upload payload exceeds the per-request limit."); }
      }
    }
    return json({ received, ms: Math.round(performance.now() - t0) }, 200, { "Cache-Control": "no-store" });
  }

  if (op === "meta") {
    // The client's IP is used ONLY to answer this request (geo/ASN estimate) —
    // it is not persisted, and logs get a truncated form.
    let info: Record<string, unknown> = { ip: ip === "unknown" ? null : ip, ip_version: ip.includes(":") ? "IPv6" : "IPv4", approximate: true };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: ctrl.signal, headers: { "User-Agent": "ToolDeck-speedtest/2.0" } });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (!j.error) {
          info = {
            ...info,
            city: j.city ?? null, region: j.region ?? null, country: j.country_name ?? null,
            asn: j.asn ?? null, org: j.org ?? null,
          };
        }
      }
    } catch { /* lookup failed — fields stay absent; test proceeds regardless */ }
    log("speed_meta", { ip_trunc: ip.replace(/(\d+\.\d+)\..*/, "$1.x.x").replace(/^([0-9a-f:]{1,9}).*/i, "$1…") });
    return json(info, 200, { "Cache-Control": "no-store" });
  }

  return fail(400, "bad_op", "Use ?op=ping|down|up|meta");
});
