/* Sheaf app: camera.js
   One camera stream at a time, shared by the document scanner and the QR reader, plus the
   full-screen layer both use. The stream stops when the app goes to the background and
   comes back when it returns. Plain script sharing Sheaf's top-level scope. */
'use strict';
const Cam = (() => {
  let stream = null, again = null, paused = false;

  async function start(video, opts = {}) {
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('This device does not let Sheaf use the camera. Pick a photo instead.'), { code: 'nocam' });
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: opts.w || 1920 }, height: { ideal: opts.h || 1080 } },
      });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      throw Object.assign(new Error(denied
        ? 'Camera access is off for Sheaf. Turn it on in your phone’s Settings, or pick a photo instead.'
        : 'The camera could not be opened. Close other camera apps, or pick a photo instead.'), { code: denied ? 'denied' : 'nocam' });
    }
    again = () => start(video, opts).then(() => opts.onRestart && opts.onRestart(), () => {});
    video.muted = true; video.setAttribute('playsinline', ''); video.srcObject = stream;
    await video.play().catch(() => {});
    if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
    return stream;
  }
  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; again = null; paused = false;
  }
  const track = () => stream && stream.getVideoTracks()[0];
  function canTorch() {
    const t = track();
    try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch { return false; }
  }
  async function torch(on) { const t = track(); if (t) await t.applyConstraints({ advanced: [{ torch: !!on }] }); }

  /* The current frame on a canvas, scaled so its long side is at most `max`. */
  function frame(video, max = Infinity) {
    const w = video.videoWidth, hh = video.videoHeight, s = Math.min(1, max / Math.max(w, hh));
    const c = makeCanvas(w * s, hh * s);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) {
      const resume = again;
      stream.getTracks().forEach(t => t.stop()); stream = null; paused = true; again = resume;
    } else if (!document.hidden && paused && again) { paused = false; again(); }
  });

  return { start, stop, canTorch, torch, frame, get live() { return !!stream; } };
})();

/* A full-screen layer above the app. The back button closes the newest one. */
function layer(cls, onClose) {
  const el = h('div', { class: 'layer ' + cls, role: 'dialog', 'aria-modal': 'true' });
  let off = () => {};
  const close = () => { if (!el.isConnected) return; off(); el.remove(); if (!document.querySelector('.layer')) document.body.classList.remove('layered'); onClose && onClose(); };
  if (window.SheafNative) off = SheafNative.onBack(() => { if (!el.isConnected) return false; close(); return true; });
  document.body.append(el); document.body.classList.add('layered');
  return { el, close };
}

/* Where a video (object-fit: contain) actually draws inside its box. */
function containRect(boxW, boxH, w, hh) {
  const s = Math.min(boxW / w, boxH / hh);
  return { x: (boxW - w * s) / 2, y: (boxH - hh * s) / 2, s };
}

/* Copy text, with a fallback for WebViews that block the async clipboard. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
    ta.remove(); return ok;
  }
}
