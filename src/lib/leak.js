/* WebRTC + DNS leak helpers. Parsing and verdict logic is pure and unit-tested;
   the browser/network wrappers at the bottom are thin. */

/* ── addresses ─────────────────────────────────────────────────────────── */

export function classifyAddress(addr) {
  const a = String(addr).toLowerCase();
  if (a.endsWith(".local")) return "mdns";
  if (a.includes(":")) {
    if (a === "::1") return "loopback";
    if (/^fe[89ab]/.test(a)) return "linklocal";
    if (/^f[cd]/.test(a)) return "private";
    return "public";
  }
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "unknown";
  const [x, y] = [+m[1], +m[2]];
  if (x === 127) return "loopback";
  if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127)) return "private";
  if (x === 169 && y === 254) return "linklocal";
  return "public";
}

/** Parse one ICE candidate line. Returns null for anything that is not a candidate. */
export function parseCandidate(line) {
  const m = String(line).match(/^(?:a=)?candidate:\S+\s+\d+\s+(\w+)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+(\w+)/i);
  if (!m) return null;
  const address = m[2];
  return { protocol: m[1].toLowerCase(), address, port: Number(m[3]), type: m[4].toLowerCase(), kind: classifyAddress(address) };
}

/**
 * known: { v4, v6 } public addresses already detected (either may be null).
 * level: "blocked" (no candidates at all), "leak" (a public IP that is not the one the site sees),
 *        "local" (private LAN address exposed), "unknown" (public addresses seen, but the
 *        site-visible address of that family isn't known, so a leak can't be ruled out), "ok".
 */
export function webrtcVerdict(candidates, known = {}) {
  const seen = new Map();
  for (const c of candidates) if (c && !seen.has(c.address)) seen.set(c.address, c);
  const all = [...seen.values()];
  const pub = all.filter((c) => c.kind === "public");
  const local = all.filter((c) => c.kind === "private" || c.kind === "linklocal");
  const mdns = all.filter((c) => c.kind === "mdns");

  const norm = (s) => (s ? String(s).toLowerCase() : null);
  const k4 = norm(known.v4), k6 = norm(known.v6);
  const knownFor = (c) => (c.address.includes(":") ? k6 : k4);
  const mismatched = pub.filter((c) => knownFor(c) && c.address.toLowerCase() !== knownFor(c));
  const unverified = pub.filter((c) => !knownFor(c));

  let level = "ok";
  if (!all.length) level = "blocked";
  else if (mismatched.length) level = "leak";
  else if (local.length) level = "local";
  else if (unverified.length) level = "unknown";

  return {
    level, publicIps: pub.map((c) => c.address), localIps: local.map((c) => c.address), mdnsCount: mdns.length,
    mismatched: mismatched.map((c) => c.address), unverified: unverified.map((c) => c.address),
  };
}

/* ── DNS ───────────────────────────────────────────────────────────────── */

/** Third-party test server: resolves unique sub-domains and reports which DNS resolvers asked for them. */
export const DNS_PROVIDER = {
  name: "bash.ws",
  idUrl: "https://bash.ws/id",
  probeUrl: (i, id) => `https://${i}.${id}.bash.ws/`,
  resultUrl: (id) => `https://bash.ws/dnsleak/test/${id}?json`,
};

/** Provider payload -> { resolvers[], conclusion } or null when the shape is unrecognised. */
export function parseDnsLeak(payload) {
  if (!Array.isArray(payload)) return null;
  const resolvers = payload.filter((r) => r && r.type === "dns" && r.ip)
    .map((r) => ({ ip: String(r.ip), country: r.country_name || null, asn: r.asn ? String(r.asn) : null }));
  const concl = payload.find((r) => r && r.type === "conclusion");
  return { resolvers, conclusion: concl?.ip ? String(concl.ip) : null };
}

export function dnsSummary(resolvers) {
  const asns = new Set(resolvers.map((r) => r.asn).filter(Boolean));
  const countries = new Set(resolvers.map((r) => r.country).filter(Boolean));
  return { count: resolvers.length, networks: asns.size, countries: countries.size };
}

/** fetch with its own deadline (covering the body read in `read`), still honouring the caller's signal. */
async function timedFetch(fetchFn, url, init, ms, read = (r) => r) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  if (init.signal?.aborted) ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await read(await fetchFn(url, { ...init, signal: ctrl.signal }));
  } catch (e) {
    if (init.signal?.aborted) throw e;                      // the caller cancelled: let AbortError through
    if (ctrl.signal.aborted) throw new Error("The DNS test service is unavailable (it timed out).");
    throw e;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** Runs the provider flow. `fetchFn` is injectable for tests. */
export async function runDnsLeakTest(fetchFn = fetch, { probes = 8, settleMs = 1200, signal, timeoutMs = 8000, probeTimeoutMs = 5000 } = {}) {
  const id = await timedFetch(fetchFn, DNS_PROVIDER.idUrl, { cache: "no-store", signal }, timeoutMs, async (idRes) => {
    if (!idRes.ok) throw new Error("The DNS test service is unavailable.");
    return (await idRes.text()).trim();
  });
  if (!/^[a-z0-9]{8,64}$/i.test(id)) throw new Error("The DNS test service returned an unexpected response.");
  /* a probe that hangs must not hold the whole test: each one gets its own deadline */
  await Promise.allSettled(Array.from({ length: probes }, (_, i) =>
    timedFetch(fetchFn, DNS_PROVIDER.probeUrl(i + 1, id), { mode: "no-cors", cache: "no-store", signal }, probeTimeoutMs)));
  if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  const payload = await timedFetch(fetchFn, DNS_PROVIDER.resultUrl(id), { cache: "no-store", signal }, timeoutMs, async (res) => {
    if (!res.ok) throw new Error("The DNS test service is unavailable.");
    return res.json();
  });
  const parsed = parseDnsLeak(payload);
  if (!parsed) throw new Error("The DNS test service returned an unexpected response.");
  return parsed;
}

/* ── browser wrapper ───────────────────────────────────────────────────── */

/** Gathers ICE candidates via a STUN server. Returns { supported, candidates[] }. */
export function collectIceCandidates({ timeoutMs = 4000, stun = "stun:stun.l.google.com:19302" } = {}) {
  if (typeof RTCPeerConnection === "undefined") return Promise.resolve({ supported: false, candidates: [] });
  return new Promise((resolve) => {
    const out = [];
    let pc;
    const done = () => { try { pc.close(); } catch { /* already closed */ } resolve({ supported: true, candidates: out }); };
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] }); } catch { return resolve({ supported: false, candidates: [] }); }
    const t = setTimeout(done, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(t); done(); return; }
      const c = parseCandidate(e.candidate.candidate);
      if (c) out.push(c);
    };
    pc.createDataChannel("probe");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => { clearTimeout(t); done(); });
  });
}
