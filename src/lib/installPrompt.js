/* "Install ToolDeck" offer: shown at most once per device, never to people who already installed it. */

export const OFFER_KEY = "toolDeck.installOffered";
export const LEGACY_KEY = "toolDeck.install-prompt-dismissed"; // the old prompt's key: anyone who ever saw it counts as offered
export const OFFER_DELAY_MS = 8000;

/** storage may be missing or throw (private mode); treat that as "not offered yet" but never crash. */
export function wasOffered(storage) {
  try { return !!(storage?.getItem(OFFER_KEY) || storage?.getItem(LEGACY_KEY)); } catch { return false; }
}

export function markOffered(storage, now = Date.now()) {
  if (!storage) return false;
  try { storage.setItem(OFFER_KEY, String(now)); return true; } catch { return false; }
}

/**
 * kind: "native" (browser can show its install dialog), "ios" (needs manual Share → Add to Home Screen) or null (don't show).
 * The caller applies OFFER_DELAY_MS and the per-page-load "already shown" flag.
 */
export function decideOffer({ offered, installed, hasNativePrompt, isIOS }) {
  if (offered || installed) return null;
  if (hasNativePrompt) return "native";
  if (isIOS) return "ios";
  return null;
}

export function isStandalone(win = globalThis.window) {
  try { return !!(win?.matchMedia?.("(display-mode: standalone)").matches || win?.navigator?.standalone === true); } catch { return false; }
}

export const isIOSDevice = (ua = globalThis.navigator?.userAgent || "") => /iPad|iPhone|iPod/.test(ua);
