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

/** One-line shareable summary. */
export function summaryText(r) {
  const f = (v, u) => (v == null ? "—" : `${v}${u}`);
  return [
    `ToolDeck speed test · ${r.when}`,
    `↓ ${f(r.down, " Mbps")} · ↑ ${f(r.up, " Mbps")}`,
    `Idle latency ${f(r.ping, " ms")} · jitter ${f(r.jitter, " ms")}`,
    `Loaded latency ↓ ${f(r.loadedDown, " ms")} · ↑ ${f(r.loadedUp, " ms")}`,
    `Packet loss: ${r.loss ?? "Unavailable over HTTP"}`,
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
