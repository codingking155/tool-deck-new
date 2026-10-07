/* Sheaf app: native.src.js -> www/app/native.js (bundled by scripts/build-web.mjs)
   The few things a phone app does differently from the web page: saving into Documents/Sheaf,
   the Android share sheet, opening links in other apps, and the hardware back button.
   Exposes window.SheafNative; in a plain browser `native` is false and the callers fall back. */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

const native = Capacitor.isNativePlatform();
const FOLDER = 'Sheaf';

function base64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error || new Error('The file could not be read.'));
    r.readAsDataURL(blob);
  });
}
const clean = name => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'file';

async function exists(path, directory) {
  try { await Filesystem.stat({ path, directory }); return true; } catch { return false; }
}

/* Android 9 and older need the storage permission to write to Documents; newer versions do not. */
async function storageReady() {
  try {
    const p = await Filesystem.checkPermissions();
    if (p.publicStorage === 'granted') return;
    const r = await Filesystem.requestPermissions();
    if (r.publicStorage !== 'granted') throw new Error('Sheaf needs storage access to save files. Allow it in Settings.');
  } catch (e) { if (/storage access/.test(e.message)) throw e; /* platform without the permission */ }
}

/* Save into Documents/Sheaf without overwriting: "a.pdf", "a (2).pdf", ... Returns the shown path. */
async function save(name, blob) {
  await storageReady();
  const safe = clean(name), dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe, ext = dot > 0 ? safe.slice(dot) : '';
  let file = safe;
  for (let k = 2; await exists(`${FOLDER}/${file}`, Directory.Documents); k++) file = `${stem} (${k})${ext}`;
  await Filesystem.writeFile({ path: `${FOLDER}/${file}`, data: await base64(blob), directory: Directory.Documents, recursive: true });
  return `Documents/${FOLDER}/${file}`;
}

const cancelled = e => /cancel/i.test((e && e.message) || '');

/* Share [{name, blob}] through the system sheet (WhatsApp, Drive, Gmail, ...). */
async function share(files, title = 'Share') {
  const uris = [];
  for (const f of files) {
    const r = await Filesystem.writeFile({ path: `share/${clean(f.name)}`, data: await base64(f.blob), directory: Directory.Cache, recursive: true });
    uris.push(r.uri);
  }
  try { await Share.share({ title, files: uris, dialogTitle: title }); } catch (e) { if (!cancelled(e)) throw e; }
}
async function shareText(text, title = 'Share') {
  try { await Share.share({ title, text, dialogTitle: title }); } catch (e) { if (!cancelled(e)) throw e; }
}

/* Links, UPI, tel:, mailto:, geo: go to the app that handles them. Capacitor hands any
   navigation away from the app's own origin to Android as an intent. */
function openUrl(url) { window.location.href = url; }

/* Back button: the newest handler that returns true wins (dialogs, camera); otherwise go back
   through the hash routes, and leave the app from the home screen. */
const backs = [];
function onBack(fn) { backs.push(fn); return () => { const i = backs.indexOf(fn); if (i >= 0) backs.splice(i, 1); }; }
if (native) {
  App.addListener('backButton', ({ canGoBack }) => {
    for (let i = backs.length - 1; i >= 0; i--) if (backs[i]()) return;
    const open = document.querySelector('dialog[open]');
    if (open) {
      const ev = new Event('cancel', { cancelable: true });
      open.dispatchEvent(ev);
      if (!ev.defaultPrevented) open.close();
      return;
    }
    if (location.hash && location.hash !== '#/' && canGoBack) history.back();
    else if (location.hash && location.hash !== '#/') location.hash = '#/';
    else App.exitApp();
  });
}

window.SheafNative = { native, save, share, shareText, openUrl, onBack };
