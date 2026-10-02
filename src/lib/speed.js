/** Speed-test engine v2.
    Real transfers only. Every number shown to the user is produced by the
    tested formulas in speedCore.mjs. Cancellation aborts every in-flight
    request; a global byte counter enforces the ~200 MB data budget. */

import { median, cleanSamples, jitterOf, windowMbps, finalMbps, parseCfL4, aggregateLoss, isStable } from "./speedCore.mjs";
export { summaryText, historyCsv, compareRuns } from "./speedCore.mjs";

const DATA_BUDGET = 200 * 1024 * 1024;
/* download may use most of the budget, but never the part upload needs:
   on a fast link it would otherwise spend all 200 MB and leave upload "Unavailable" */
const DOWNLOAD_SHARE = 0.7;

/* ── servers ──────────────────────────────────────────────────────────── */

const COLO_CITY = { BLR: "Bengaluru", MAA: "Chennai", BOM: "Mumbai", DEL: "New Delhi", HYD: "Hyderabad", CCU: "Kolkata", SIN: "Singapore", LHR: "London", FRA: "Frankfurt", IAD: "Ashburn", SJC: "San Jose", NRT: "Tokyo", SYD: "Sydney", DXB: "Dubai" };

export function availableServers() {
  const list = [{
    id: "cf", name: "Global edge (nearest city)",
    ping: "https://speed.cloudflare.com/__down?bytes=0",
    down: (b) => `https://speed.cloudflare.com/__down?bytes=${b}`,
    up: "https://speed.cloudflare.com/__up",
    meta: "https://speed.cloudflare.com/meta",
  }];
  const base = import.meta.env?.VITE_SUPABASE_URL;
  if (base) {
    const fn = `${base}/functions/v1/speedtest`;
    list.push({
      id: "td", name: "ToolDeck server",
      ping: `${fn}?op=ping`, down: (b) => `${fn}?op=down&bytes=${b}`, up: `${fn}?op=up`, meta: `${fn}?op=meta`,
    });
  }
  return list;
}

/* ── latency ──────────────────────────────────────────────────────────── */

async function probeOnce(url, signal, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const t0 = performance.now();
    const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}n=${Math.random()}`, { cache: "no-store", signal: ctrl.signal });
    await r.arrayBuffer();
    if (!r.ok) return null;             // a 429/5xx is a failed probe, not a latency sample
    return performance.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function measureLatency(server, { probes = 12, signal, onSample } = {}) {
  const raw = [];
  for (let i = 0; i < probes; i++) {
    if (signal?.aborted) break;
    raw.push(await probeOnce(server.ping, signal));
    onSample && onSample(raw);
  }
  const clean = cleanSamples(raw);
  return {
    ping: clean.length ? Math.round(median(clean)) : null,
    jitter: clean.length > 1 ? Math.round(jitterOf(clean) * 10) / 10 : null,
    lost: raw.filter((x) => x == null).length,
    total: raw.length,
  };
}

/** Background prober used while a transfer runs → loaded latency. */
function startLoadedProber(server, signal) {
  const samples = [];
  let stopped = false;
  (async () => {
    while (!stopped && !signal?.aborted) {
      const v = await probeOnce(server.ping, signal, 3000);
      if (v != null) samples.push(v);
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return {
    stop() {
      stopped = true;
      const clean = cleanSamples(samples);
      return clean.length ? Math.round(median(clean)) : null;
    },
  };
}

/* ── server selection ─────────────────────────────────────────────────── */

export async function pickServer(servers, { signal } = {}) {
  const results = await Promise.all(servers.map(async (s) => {
    const r = await measureLatency(s, { probes: 3, signal });
    return { server: s, ping: r.ping };
  }));
  const healthy = results.filter((r) => r.ping != null).sort((a, b) => a.ping - b.ping);
  return { best: healthy[0]?.server ?? null, all: results };
}

/* ── download ─────────────────────────────────────────────────────────── */

export async function runDownload(server, { signal, onLive, budget, minMs = 4500, maxMs = 10000, streams = 6 } = {}) {
  const sizes = [10e6, 25e6, 50e6];
  const samples = [{ t: performance.now(), bytes: 0 }];
  const cfL4 = [];
  const stability = [];
  const t0 = performance.now();
  let sizeIdx = 0, done = false, lastStab = t0;

  const shouldStop = () => {
    const now = performance.now();
    if (now - t0 > maxMs) return true;
    /* sample the sliding window ~every 300 ms; stop once it's flat */
    if (now - lastStab >= 300) {
      lastStab = now;
      stability.push(windowMbps(samples));
      if (now - t0 > minMs && isStable(stability, 5, 0.05)) return true;
    }
    return false;
  };

  async function stream() {
    while (!done && !signal?.aborted) {
      /* streams reserve budget concurrently; when the next size doesn't fit,
         fall back to a smaller one, and end only this stream if none fits.
         (Setting the shared `done` here used to stop all six streams the
         first time any one of them hit the budget.) */
      let size = 0;
      for (let i = Math.min(sizeIdx, sizes.length - 1); i >= 0; i--) {
        if (!budget || budget.take(sizes[i])) { size = sizes[i]; break; }
      }
      if (!size) break;
      let read = 0;
      try {
        const r = await fetch(server.down(size), { cache: "no-store", signal });
        if (!r.ok) {                    // error bodies are not throughput; back off instead of hammering
          budget?.refund(size);
          try { await r.body?.cancel(); } catch { /* closed */ }
          await new Promise((res) => setTimeout(res, r.status === 429 ? 1500 : 300));
          if (shouldStop()) done = true;
          continue;
        }
        /* cfL4 counters are cumulative per TCP connection and snapshotted at
           response-header time, so each request reports the retransmissions
           of everything that ran on that connection before it */
        const l4 = parseCfL4(r.headers.get("server-timing"));
        if (l4) cfL4.push(l4);
        if (!r.body) break;
        const reader = r.body.getReader();
        for (;;) {
          const { done: d, value } = await reader.read();
          if (d) break;
          read += value.length;
          samples.push({ t: performance.now(), bytes: value.length });
          onLive && onLive(windowMbps(samples));
          if (shouldStop()) { done = true; try { await reader.cancel(); } catch { /* closed */ } break; }
        }
        budget?.refund(size - read);
        sizeIdx++;
      } catch { budget?.refund(size - read); if (signal?.aborted) break; await new Promise((r) => setTimeout(r, 150)); }
      if (shouldStop()) done = true;
    }
  }

  await Promise.all(Array.from({ length: streams }, stream));

  /* trailing zero-byte probes reuse the warm connections, so their headers
     carry the final cumulative counters including the last big transfers */
  if (!signal?.aborted) {
    await Promise.all(Array.from({ length: Math.min(streams, 4) }, async () => {
      try {
        const r = await fetch(server.down(0), { cache: "no-store", signal });
        const l4 = parseCfL4(r.headers.get("server-timing"));
        if (l4) cfL4.push(l4);
        await r.arrayBuffer();
      } catch { /* counters just stay at the last snapshot */ }
    }));
  }
  const bytes = samples.reduce((a, s) => a + s.bytes, 0);
  if (bytes < 200000) return { mbps: null, bytes, loss: null };   // not enough data to be honest
  return { mbps: +finalMbps(samples).toFixed(1), bytes, loss: aggregateLoss(cfL4) };
}

/* ── upload ───────────────────────────────────────────────────────────── */

function randomPayload(n) {
  const buf = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) {
    crypto.getRandomValues(buf.subarray(off, Math.min(off + 65536, n)));
  }
  return buf;
}

/* Upload chunk ladder. A POST only reports progress when it completes, so a
   fixed multi-MB chunk on a slow uplink (1–2 Mbps is common on mobile) took
   tens of seconds with the gauge stuck at 0 and ran far past maxMs. Each
   stream starts small and steps up only while requests finish quickly. */
const UP_LADDER = [128e3, 256e3, 512e3, 1e6, 2e6, 4e6, 8e6, 16e6];
const UP_GROW_MS = 1200;    // a request faster than this → next one is bigger
const UP_SHRINK_MS = 3500;  // slower than this → step back down
const UP_GRACE_MS = 2500;   // in-flight requests are aborted at maxMs + this

export async function runUpload(server, { signal, onLive, budget, minMs = 4000, maxMs = 8000, streams = 4 } = {}) {
  const payload = randomPayload(UP_LADDER[UP_LADDER.length - 1]);
  const samples = [{ t: performance.now(), bytes: 0 }];
  const stability = [];
  const t0 = performance.now();
  let done = false;

  /* one controller for the whole phase: user cancel, or the hard deadline */
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = setTimeout(() => { done = true; ctrl.abort(); }, maxMs + UP_GRACE_MS);

  const shouldStop = () => {
    const now = performance.now();
    if (now - t0 > maxMs) return true;
    stability.push(windowMbps(samples, 3000));
    return now - t0 > minMs && isStable(stability, 4, 0.08);
  };

  async function stream() {
    let idx = 0;
    while (!done && !ctrl.signal.aborted) {
      const size = UP_LADDER[idx];
      if (budget && !budget.take(size)) { done = true; break; }
      const started = performance.now();
      try {
        /* server.up is a plain URL (unlike .down, it isn't parameterized by size) */
        const r = await fetch(server.up, { cache: "no-store", method: "POST", body: payload.subarray(0, size), signal: ctrl.signal });
        try { await r.arrayBuffer(); } catch { /* body irrelevant */ }
        if (!r.ok) { budget?.refund(size); await new Promise((res) => setTimeout(res, r.status === 429 ? 1500 : 300)); if (shouldStop()) done = true; continue; }
        const took = performance.now() - started;
        samples.push({ t: performance.now(), bytes: size });
        onLive && onLive(windowMbps(samples, 3000));
        if (took < UP_GROW_MS) idx = Math.min(idx + 1, UP_LADDER.length - 1);
        else if (took > UP_SHRINK_MS) idx = Math.max(idx - 1, 0);
      } catch { budget?.refund(size); if (ctrl.signal.aborted) break; await new Promise((r) => setTimeout(r, 150)); }
      if (shouldStop()) done = true;
    }
  }

  try {
    await Promise.all(Array.from({ length: streams }, stream));
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", onAbort);
  }
  const bytes = samples.reduce((a, s) => a + s.bytes, 0);
  if (bytes < 200000) return { mbps: null, bytes };
  return { mbps: +finalMbps(samples).toFixed(1), bytes };
}

/* ── metadata (connection panel) ──────────────────────────────────────── */

export async function fetchMeta(server, { signal } = {}) {
  try {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(server.meta, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
    if (!r.ok) return null;
    const j = await r.json();
    /* Cloudflare /meta shape → normalized; ToolDeck ?op=meta is already normalized */
    const ip = j.ip ?? j.clientIp ?? null;
    return {
      ip,
      ipVersion: j.ip_version ?? (ip ? (ip.includes(":") ? "IPv6" : "IPv4") : null),
      city: j.city ?? null,
      region: j.region ?? null,
      country: j.country ?? j.country_name ?? null,
      asn: j.asn != null ? String(j.asn).replace(/^(?!AS)/, "AS") : null,
      org: j.org ?? j.asOrganization ?? null,
      serverLoc: j.colo ? (() => { const colo = typeof j.colo === 'object' ? j.colo.iata : j.colo; return COLO_CITY[colo] ? `${COLO_CITY[colo]} (${colo})` : (typeof j.colo === 'object' ? `${j.colo.city ?? j.colo.iata}` : colo); })() : null,
      approximate: true,
    };
  } catch { return null; }
}

/* ── orchestration ────────────────────────────────────────────────────── */

export function makeBudget(limit = DATA_BUDGET) {
  let used = 0;
  return {
    take(n) { if (used + n > limit) return false; used += n; return true; },
    /* give back bytes reserved for a request that was cut short or failed,
       so download doesn't starve the upload phase of budget it never used */
    refund(n) { used = Math.max(0, used - Math.max(0, n)); },
    get used() { return used; },
  };
}

/** Full test run. Reports through cb: (stage, payload). Returns the result
    object, or throws { cancelled: true } / { offline: true }. */
export async function runFullTest(server, servers, cb, signal) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw { offline: true };
  const downBudget = makeBudget(Math.round(DATA_BUDGET * DOWNLOAD_SHARE));
  let upBudget = null;
  let hiddenDuring = false;
  const onVis = () => { if (document.hidden) hiddenDuring = true; };
  document.addEventListener("visibilitychange", onVis);
  try {
    let srv = server;
    if (!srv) {
      cb("finding");
      const { best } = await pickServer(servers, { signal });
      if (signal.aborted) throw { cancelled: true };
      if (!best) throw new Error("No test server reachable");
      srv = best;
      cb("server", srv);
    }

    cb("idle");
    const idle = await measureLatency(srv, { probes: 10, signal, onSample: (s) => cb("idle_sample", s) });
    if (signal.aborted) throw { cancelled: true };
    if (idle.ping == null) throw new Error("Latency probes all failed — the server may be unreachable");

    cb("down");
    const proberD = startLoadedProber(srv, signal);
    const down = await runDownload(srv, { signal, budget: downBudget, onLive: (m) => cb("live", m) });
    const loadedDown = proberD.stop();
    if (signal.aborted) throw { cancelled: true };

    cb("up");
    const proberU = startLoadedProber(srv, signal);
    upBudget = makeBudget(DATA_BUDGET - downBudget.used);
    const up = await runUpload(srv, { signal, budget: upBudget, onLive: (m) => cb("live", m) });
    const loadedUp = proberU.stop();
    if (signal.aborted) throw { cancelled: true };

    cb("calc");
    const when = new Date();
    return {
      when: when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
      iso: when.toISOString(),
      server: srv.name, serverId: srv.id,
      ping: idle.ping, jitter: idle.jitter,
      down: down.mbps, up: up.mbps,
      loadedDown, loadedUp,
      /* Downstream loss estimate from the edge server's own TCP counters
         (Server-Timing cfL4: lost + retransmitted / sent). Null when the
         chosen server doesn't expose them. */
      loss: down.loss?.pct ?? null,
      lossDetail: down.loss ?? null,
      dataUsed: Math.round((downBudget.used + (upBudget?.used ?? 0)) / 1e6),
      tabHidden: hiddenDuring,
      partial: down.mbps == null || up.mbps == null,
    };
  } finally {
    document.removeEventListener("visibilitychange", onVis);
  }
}

export function qualityLabels(down, up, ping) {
  return [
    { l: "WhatsApp video calls", ok: down >= 1.5 && up >= 1.5 },
    { l: "HD streaming", ok: down >= 5 },
    { l: "4K streaming", ok: down >= 25 },
    { l: "Online gaming", ok: ping <= 60 && down >= 10 },
    { l: "Work from home", ok: down >= 20 && up >= 5 },
  ];
}
