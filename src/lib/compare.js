/* Pure helpers for Compare PDF: word-level diff and pixel diff. */

const MAX_CELLS = 6_000_000;

/** Word diff -> [{ t: "eq"|"add"|"del", w }]. Falls back to a block replace for huge inputs. */
export function diffWords(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const out = a.slice(0, s).map((w) => ({ t: "eq", w }));
  if ((A.length + 1) * (B.length + 1) > MAX_CELLS) {
    A.forEach((w) => out.push({ t: "del", w })); B.forEach((w) => out.push({ t: "add", w }));
  } else {
    const n = A.length, m = B.length, W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: "eq", w: A[i] }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) out.push({ t: "del", w: A[i++] });
      else out.push({ t: "add", w: B[j++] });
    }
    while (i < n) out.push({ t: "del", w: A[i++] });
    while (j < m) out.push({ t: "add", w: B[j++] });
  }
  for (const w of a.slice(ea)) out.push({ t: "eq", w });
  return out;
}

export const tokenize = (text) => String(text).split(/\s+/).filter(Boolean);

export function diffStats(ops) {
  let added = 0, removed = 0;
  for (const o of ops) { if (o.t === "add") added++; else if (o.t === "del") removed++; }
  return { added, removed, changed: added + removed > 0 };
}

/** RGBA pixel diff. Differing/non-overlapping pixels are painted red over a faded copy of A.
    Returns { percent, overlay (Uint8ClampedArray, width x height of the larger page) }. */
export function pixelDiff(a, b, threshold = 40) {
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height);
  const overlay = new Uint8ClampedArray(W * H * 4);
  let diff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const inA = x < a.width && y < a.height, inB = x < b.width && y < b.height;
    let differs = !(inA && inB);
    let gray = 255;
    if (inA) {
      const i = (y * a.width + x) * 4;
      gray = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
      if (inB) {
        const k = (y * b.width + x) * 4;
        differs = Math.abs(a.data[i] - b.data[k]) + Math.abs(a.data[i + 1] - b.data[k + 1]) + Math.abs(a.data[i + 2] - b.data[k + 2]) > threshold;
      }
    }
    if (differs) { diff++; overlay[o] = 235; overlay[o + 1] = 40; overlay[o + 2] = 40; }
    else { const f = 255 - (255 - gray) * 0.35; overlay[o] = overlay[o + 1] = overlay[o + 2] = f; }
    overlay[o + 3] = 255;
  }
  return { percent: W * H ? (diff / (W * H)) * 100 : 0, overlay, width: W, height: H };
}
