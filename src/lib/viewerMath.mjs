/* Pure geometry for the image viewer (no DOM). View transform: screen = centre + pan + img * scale. */
export const MIN_ZOOM = 0.05, MAX_ZOOM = 16;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Scale that fits a w×h image (rotated by `rot` degrees) into a box, never upscaling past 1. */
export function fitScale(w, h, boxW, boxH, rot = 0) {
  if (!(w > 0 && h > 0 && boxW > 0 && boxH > 0)) return 1;
  const side = Math.abs(rot) % 180 === 90;
  const iw = side ? h : w, ih = side ? w : h;
  return Math.min(1, boxW / iw, boxH / ih);
}

/** Clamp pan so the image can't be dragged fully off-screen; centred on an axis where it fits. */
export function clampPan(pan, w, h, scale, boxW, boxH, rot = 0) {
  const side = Math.abs(rot) % 180 === 90;
  const sw = (side ? h : w) * scale, sh = (side ? w : h) * scale;
  const mx = Math.max(0, (sw - boxW) / 2), my = Math.max(0, (sh - boxH) / 2);
  return { x: clamp(pan.x, -mx, mx) || 0, y: clamp(pan.y, -my, my) || 0 };
}

/**
 * Zoom to `next` keeping the image point under (px, py) fixed. (px, py) are relative to the box centre.
 * Returns { scale, pan } (pan unclamped — pass through clampPan).
 */
export function zoomAt(scale, pan, next, px = 0, py = 0, min = MIN_ZOOM, max = MAX_ZOOM) {
  const s = clamp(next, min, max);
  const k = s / scale;
  return { scale: s, pan: { x: px - (px - pan.x) * k, y: py - (py - pan.y) * k } };
}

/** Next step for the +/− buttons: multiplicative steps. */
export const stepZoom = (scale, dir, factor = 1.25) => clamp(dir > 0 ? scale * factor : scale / factor, MIN_ZOOM, MAX_ZOOM);

/** Saving in percent from `from` bytes to `to` bytes (positive = smaller). */
export const savingPct = (from, to) => (from > 0 ? Math.round((1 - to / from) * 100) : 0);

/** Wrap an index for prev/next. */
export const wrapIndex = (i, n) => (n > 0 ? ((i % n) + n) % n : 0);
