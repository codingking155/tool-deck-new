/** Speed-test measurement core — pure functions, no browser APIs.
    Shared by the browser engine and the node test suite, so every formula
    that produces a displayed number is unit-tested. */

/** Median of a numeric array (empty → null). */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Remove failures (null/NaN/<=0) and outliers beyond k×MAD of the median. */
export function cleanSamples(xs, k = 2.5) {
  const ok = xs.filter((x) => Number.isFinite(x) && x > 0);
  if (ok.length < 4) return ok;
  const med = median(ok);
  const mad = median(ok.map((x) => Math.abs(x - med))) || 1e-9;
  return ok.filter((x) => Math.abs(x - med) <= k * mad * 1.4826 + 1e-9);
}

/** Jitter = mean absolute successive difference (RFC 3550 flavour). */
export function jitterOf(xs) {
  if (xs.length < 2) return null;
  let s = 0;
  for (let i = 1; i < xs.length; i++) s += Math.abs(xs[i] - xs[i - 1]);
  return s / (xs.length - 1);
}

/** bits over seconds → Mbps. */
export function mbps(bytes, ms) {
  if (!ms || ms <= 0) return 0;
  return (bytes * 8) / (ms / 1000) / 1e6;
}

/** Sliding-window throughput: samples = [{t (ms), bytes}], window in ms.
    Returns Mbps over the trailing window ending at the last sample. */
export function windowMbps(samples, windowMs = 2000) {
  if (samples.length < 2) return 0;
  const end = samples[samples.length - 1].t;
  const from = end - windowMs;
  let bytes = 0, t0 = end;
  for (let i = samples.length - 1; i >= 0; i--) {
    t0 = samples[i].t;
    if (samples[i].t <= from) break;      // this sample's bytes arrived before the window
    bytes += samples[i].bytes;
  }
  return t0 >= end ? 0 : mbps(bytes, end - t0);
}

/** Final figure: exclude the warm-up fraction of wall time from the start. */
export function finalMbps(samples, warmupFrac = 0.1) {
  if (samples.length < 2) return 0;
  const start = samples[0].t, end = samples[samples.length - 1].t;
  const cut = start + (end - start) * warmupFrac;
  let bytes = 0, t0 = null;
  for (const s of samples) {
    if (s.t < cut) continue;
    if (t0 == null) t0 = s.t;
    bytes += s.bytes;
  }
  if (t0 == null || t0 >= end) return 0;
  return mbps(bytes, end - t0);
}

/** Parse Cloudflare's `cfL4` Server-Timing entry into TCP counters.
    Input: the raw Server-Timing header value; returns {cid, sent, lost,
    retrans, rttMs} or null when the entry is absent/malformed. `sent`,
    `lost` and `retrans` are cumulative per TCP connection (cid). */
export function parseCfL4(header) {
  if (!header) return null;
  const m = /cfL4;desc="\?([^"]*)"/.exec(header);
  if (!m) return null;
  const p = Object.fromEntries(m[1].split("&").map((kv) => kv.split("=")));
  const num = (k) => (p[k] != null && p[k] !== "" ? Number(p[k]) : null);
  const sent = num("sent");
  if (!Number.isFinite(sent)) return null;
  return {
    cid: p.cid ?? "?",
    sent,
    lost: num("lost") ?? 0,
    retrans: num("retrans") ?? 0,
    rttMs: Number.isFinite(num("rtt")) ? num("rtt") / 1000 : null,
  };
}

/** Aggregate cfL4 readings into a downstream loss estimate.
    Counters are cumulative per connection, so keep only the LAST reading
    per cid, then sum. Loss % = (lost + retrans) / sent. Returns
    {pct, sent, lost, retrans} or null with no usable readings. */
export function aggregateLoss(readings) {
  const last = new Map();
  for (const r of readings) if (r && Number.isFinite(r.sent)) last.set(r.cid, r);
  if (!last.size) return null;
  let sent = 0, lost = 0, retrans = 0;
  for (const r of last.values()) { sent += r.sent; lost += r.lost; retrans += r.retrans; }
  if (sent <= 0) return null;
  return { pct: +((lost + retrans) / sent * 100).toFixed(2), sent, lost, retrans };
}

/** Early-termination check: true when the last n throughput readings are
    tight around their median (coefficient of dispersion below cv). */
export function isStable(readings, n = 5, cv = 0.05) {
  if (readings.length < n) return false;
  const tail = readings.slice(-n);
  const med = median(tail);
  if (!med) return false;
  return tail.every((x) => Math.abs(x - med) / med <= cv);
}

/** One-line shareable summary. */
export function summaryText(r) {
  const f = (v, u) => (v == null ? "—" : `${v}${u}`);
  return [
    `ToolDeck speed test · ${r.when}`,
    `↓ ${f(r.down, " Mbps")} · ↑ ${f(r.up, " Mbps")}`,
    `Idle latency ${f(r.ping, " ms")} · jitter ${f(r.jitter, " ms")}`,
    `Loaded latency ↓ ${f(r.loadedDown, " ms")} · ↑ ${f(r.loadedUp, " ms")}`,
    `Packet loss: ${r.loss != null ? `${r.loss < 0.01 ? "<0.01" : r.loss}%` : (r.packetLoss?.reason ?? "Not supported by this measurement provider")}`,
    `Server: ${r.server || "—"}`,
  ].join("\n");
}

/** CSV export of a history array (newest first is fine; header included). */
export function historyCsv(rows) {
  const head = "when,server,down_mbps,up_mbps,idle_ms,jitter_ms,loaded_down_ms,loaded_up_ms";
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...rows.map((r) =>
    [r.when, r.server, r.down, r.up, r.ping, r.jitter, r.loadedDown, r.loadedUp].map(esc).join(","))].join("\n");
}

/** Delta vs the previous run for the compare strip. */
export function compareRuns(cur, prev) {
  if (!prev) return null;
  const d = (a, b) => (a == null || b == null ? null : +(a - b).toFixed(1));
  return { down: d(cur.down, prev.down), up: d(cur.up, prev.up), ping: d(cur.ping, prev.ping) };
}

/* ════════════════════════════════════════════════════════════════════════
   Diagnostics core (Phase 1 upgrade) — pure, deterministic, unit-tested.
   ════════════════════════════════════════════════════════════════════════ */

/** Stats over throughput window samples (Mbps numbers). */
export function consistencyOf(samples) {
  const xs = samples.filter((x) => Number.isFinite(x) && x > 0);
  if (xs.length < 4) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = median(xs);
  const min = Math.min(...xs), max = Math.max(...xs);
  const stdev = Math.sqrt(xs.reduce((a, b) => a + (b - avg) ** 2, 0) / xs.length);
  const variationPct = avg > 0 ? +(stdev / avg * 100).toFixed(1) : null;
  /* score: 100 at ≤5% variation, linearly down to 0 at ≥60% */
  const score = variationPct == null ? null : Math.round(Math.max(0, Math.min(100, (60 - variationPct) / 55 * 100)));
  const drops = xs.filter((x) => x < avg * 0.5).length;
  return { avg: +avg.toFixed(1), median: +med.toFixed(1), min: +min.toFixed(1), max: +max.toFixed(1),
           stdev: +stdev.toFixed(1), variationPct, score, majorDrops: drops, samples: xs.length };
}

/** Deterministic bufferbloat grade from idle vs loaded latency (ms).
    Grades by worst added latency: A+ <15, A <40, B <100, C <250, D <500, F ≥500. */
export function bufferbloatGrade(idle, loadedDown, loadedUp) {
  if (idle == null || (loadedDown == null && loadedUp == null)) return null;
  const addDown = loadedDown != null ? Math.max(0, loadedDown - idle) : null;
  const addUp = loadedUp != null ? Math.max(0, loadedUp - idle) : null;
  const worst = Math.max(addDown ?? 0, addUp ?? 0);
  const grade = worst < 15 ? "A+" : worst < 40 ? "A" : worst < 100 ? "B" : worst < 250 ? "C" : worst < 500 ? "D" : "F";
  const dir = (addUp ?? 0) > (addDown ?? 0) ? "uploading" : "downloading";
  const explanation =
    grade === "A+" || grade === "A"
      ? "Latency stays low while the line is saturated — calls and games keep working during big transfers."
      : grade === "B"
        ? `Latency rises moderately while ${dir}. Most video calls survive; competitive gaming may feel it.`
        : `Latency increases significantly while ${dir}. Video calls and online games may be affected when another device is transferring files. Router SQM/QoS usually fixes this.`;
  return { grade, addedDown: addDown != null ? Math.round(addDown) : null,
           addedUp: addUp != null ? Math.round(addUp) : null, worst: Math.round(worst), explanation };
}

/** Network health score 0–100 with per-metric subscores. Missing metrics are
    removed and remaining weights renormalised; confidence reflects coverage.
    Speed deliberately does not dominate: down+up together are 40% of weight. */
export function healthScore(m) {
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const parts = [];
  const add = (key, weight, score) => { if (score != null) parts.push({ key, weight, score: Math.round(clamp(score)) }); };
  /* log-scaled speed: 5→~40, 25→~70, 100→~95, 300+→100 */
  const speedScore = (v) => (v == null ? null : clamp(Math.log10(Math.max(0.1, v)) / Math.log10(300) * 100));
  add("download", 0.25, speedScore(m.down));
  add("upload", 0.15, speedScore(m.up));
  add("idleLatency", 0.15, m.ping == null ? null : clamp(100 - (m.ping - 5) * (100 / 195)));      // 5ms→100, 200ms→0
  add("loadedLatency", 0.15, m.bufferbloatWorst == null ? null : clamp(100 - m.bufferbloatWorst / 5)); // +500ms→0
  add("jitter", 0.1, m.jitter == null ? null : clamp(100 - m.jitter * 2));                         // 50ms→0
  add("packetLoss", 0.1, m.lossPct == null ? null : clamp(100 - m.lossPct * 40));                  // 2.5%→0
  add("consistency", 0.1, m.consistencyScore);
  if (!parts.length) return null;
  const wSum = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.score * (p.weight / wSum), 0));
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
  const confidence = +(wSum).toFixed(2); // 1.0 = every metric present
  return { score, grade, confidence, parts };
}

/** Activity suitability — status green|amber|red plus the reason, driven by
    more than raw download (upload, ping, loss, consistency all matter). */
export function activityGrades(m) {
  const loss = m.lossPct ?? 0;
  const cons = m.consistencyScore ?? 100;
  const ping = m.ping ?? 999, down = m.down ?? 0, up = m.up ?? 0;
  const loaded = m.bufferbloatWorst ?? 0;
  const G = "good", A = "fair", R = "poor";
  const rows = [
    ["Messaging & voice calls", up >= 0.5 && ping <= 300 && loss < 5 ? G : R, "needs modest upload and any reasonable latency"],
    ["WhatsApp video calls", down >= 1.5 && up >= 1.5 && loss < 2 ? (ping <= 150 ? G : A) : R, "≥1.5 Mbps both ways, low loss"],
    ["HD streaming", down >= 5 ? (cons >= 50 ? G : A) : R, "≥5 Mbps sustained; instability causes rebuffering"],
    ["4K streaming", down >= 25 ? (cons >= 55 ? G : A) : R, "≥25 Mbps sustained"],
    ["Video conferencing", down >= 4 && up >= 3 && ping <= 150 && loss < 1.5 ? (loaded < 250 ? G : A) : R, "symmetric-ish bandwidth, low loss, low loaded latency"],
    ["Remote work", down >= 20 && up >= 5 ? (loaded < 250 ? G : A) : R, "bandwidth plus responsiveness under load"],
    ["Online gaming", ping <= 60 && loss < 1 && (m.jitter ?? 99) <= 20 ? (loaded < 100 ? G : A) : R, "latency, jitter and loss matter more than speed"],
    ["Cloud gaming", down >= 35 && ping <= 40 && loss < 0.5 ? (loaded < 60 ? G : A) : R, "high bandwidth AND very low latency"],
    ["Large downloads", down >= 50 ? G : down >= 10 ? A : R, "raw download throughput"],
    ["Cloud backup", up >= 10 ? G : up >= 3 ? A : R, "raw upload throughput"],
  ];
  return rows.map(([label, status, why]) => ({ label, status, why }));
}

/** IP classification states — honest about what a browser session can know.
    observations: [{ip, iso}] newest first, from this device's local history. */
export function classifyIp(currentIp, observations = []) {
  if (!currentIp) return { state: "Unknown", detail: "No public IP was detected in this session." };
  const seen = observations.filter((o) => o && o.ip);
  if (seen.length < 2) return {
    state: "Cannot be determined automatically",
    detail: "Static versus dynamic addressing usually cannot be determined reliably from a single browser session.",
  };
  const distinct = new Set(seen.map((o) => o.ip));
  if (distinct.size > 1) return {
    state: "Dynamic (observed)",
    detail: `This device has observed ${distinct.size} different public addresses across ${seen.length} recorded tests — the address changes over time.`,
  };
  const first = new Date(seen[seen.length - 1].iso), last = new Date(seen[0].iso);
  const days = Math.max(0, (last - first) / 86400000);
  if (days >= 7) return {
    state: "Possibly static",
    detail: `The same address has been observed for ${Math.round(days)} days on this device. Long-lease dynamic addresses can look identical — only your ISP can confirm a static assignment.`,
  };
  return {
    state: "Likely dynamic",
    detail: "The address has been stable so far, but the observation window is under a week — most consumer connections use dynamic addressing.",
  };
}

/** Browser / OS / device parsing — Client Hints first, UA fallback. Pure. */
export function parseClient({ uaData = null, ua = "", platform = "", touchPoints = 0 } = {}) {
  const brands = (uaData?.brands ?? []).map((b) => b.brand).join(" ");
  const pick = (s, re) => re.test(s);
  let browser = "Other browser";
  const src = brands + " " + ua;
  if (pick(src, /Edg(?:e|A|iOS)?\//) || /Microsoft Edge/i.test(brands)) browser = "Edge";
  else if (pick(src, /OPR\/|Opera/)) browser = "Opera";
  else if (/Google Chrome/i.test(brands) || (/Chrome\//.test(ua) && !/Chromium/i.test(brands))) browser = "Chrome";
  else if (/Chromium/i.test(src)) browser = "Other Chromium browser";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  const verMatch = ua.match(/(?:Chrome|Firefox|Version|Edg)\/(\d+)/);
  const version = uaData?.uaFullVersion?.split(".")[0] ?? verMatch?.[1] ?? null;

  const plat = uaData?.platform || platform || ua;
  let os = "Unknown OS", device = "Unknown device";
  if (/Win/i.test(plat)) { os = "Windows"; device = "Windows desktop"; }
  else if (/Android/i.test(plat + ua)) { os = "Android"; device = /Tablet|Tab\b/i.test(ua) ? "Tablet" : "Android phone"; }
  else if (/iPhone/i.test(ua)) { os = "iOS"; device = "iPhone"; }
  else if (/iPad/i.test(ua) || (/Mac/i.test(plat) && touchPoints > 1)) { os = "iPadOS"; device = "Tablet"; }
  else if (/Mac/i.test(plat)) { os = "macOS"; device = "macOS laptop"; }
  else if (/Linux|X11/i.test(plat + ua)) { os = "Linux"; device = "Linux desktop"; }
  const mobile = uaData?.mobile;
  if (mobile === true && device.includes("desktop")) device = "Android phone";
  return { browser, version, os, device };
}

/** Deterministic plain-language diagnosis + evidence-linked recommendations. */
export function diagnose(r, prevMedianDown = null) {
  const lines = [], recs = [];
  const bb = r.bufferbloat, cons = r.consistency;
  if (r.down != null && r.down >= 25 && (r.ping ?? 999) <= 60 && (cons?.score ?? 100) >= 60 && (r.lossPct ?? 0) < 0.5 && (bb == null || "A+A".includes(bb.grade)))
    lines.push("Your connection is fast and stable.");
  if (bb && "CDF".includes(bb.grade)) {
    lines.push(`Latency under load rises by ${bb.worst} ms (grade ${bb.grade}) — ${(bb.addedUp ?? 0) > (bb.addedDown ?? 0) ? "upload" : "download"} traffic congests the line.`);
    recs.push("Enable SQM/QoS on the router, or pause cloud backups during calls.");
  }
  if ((r.lossPct ?? 0) >= 0.5) {
    lines.push(`Packet loss of ${r.lossPct}% may affect calls and gaming.`);
    recs.push("Try Ethernet or move closer to the access point, then retest.");
  }
  if (cons && cons.score != null && cons.score < 50) {
    lines.push(`Throughput varied by ${cons.variationPct}% during the test (${cons.majorDrops} major drop${cons.majorDrops === 1 ? "" : "s"}).`);
    recs.push("If on Wi-Fi, run a wired comparison test to separate router issues from ISP issues.");
  }
  if (prevMedianDown != null && r.down != null && prevMedianDown > 0) {
    const delta = (r.down - prevMedianDown) / prevMedianDown * 100;
    if (delta <= -25) { lines.push(`Download is ${Math.abs(Math.round(delta))}% below your recent median.`); recs.push("Test at another time; if it persists, contact the ISP with an exported report."); }
    else if (delta >= 25) lines.push(`Download is ${Math.round(delta)}% above your recent median.`);
  }
  if (!lines.length) lines.push("No significant issues detected in this run.");
  return { lines, recs };
}

/** Log-scale gauge geometry: Mbps → needle angle in degrees over a 240° arc.
    0.1 Mbps → 0°, gaugeMax → 240°. Pure so the mapping is testable. */
export function gaugeAngle(mbps, max = 1000) {
  if (!Number.isFinite(mbps) || mbps <= 0.1) return 0;
  const t = Math.log10(mbps / 0.1) / Math.log10(max / 0.1);
  return Math.max(0, Math.min(240, t * 240));
}

/** History schema v3 + migration from v2 records. */
export const HISTORY_VERSION = 3;
export function migrateHistory(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => r && r.v === HISTORY_VERSION ? r : {
    v: HISTORY_VERSION,
    id: r.iso ?? String(Math.random()),
    when: r.when ?? null, iso: r.iso ?? null,
    down: r.down ?? null, up: r.up ?? null, ping: r.ping ?? null, jitter: r.jitter ?? null,
    loadedDown: r.loadedDown ?? null, loadedUp: r.loadedUp ?? null,
    lossPct: r.loss ?? null, consistencyScore: null, bufferbloatGrade: null,
    provider: r.server ?? null, serverId: r.serverId ?? null,
    isp: null, asn: null, ipMasked: null, ipClass: null,
    client: null, mode: "standard", dataUsed: r.dataUsed ?? null,
  }).filter((r) => r.iso);
}

/** Privacy-preserving IP display/storage: keep /24 (v4) or /48-ish (v6). */
export function maskIp(ip) {
  if (!ip) return null;
  if (ip.includes(":")) { const p = ip.split(":"); return p.slice(0, 3).join(":") + "::…"; }
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : ip;
}
