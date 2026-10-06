import { useEffect, useRef, useState } from "react";
import { OFFER_DELAY_MS, wasOffered, markOffered, decideOffer, isStandalone, isIOSDevice } from "../lib/installPrompt.js";

const store = () => { try { return window.localStorage; } catch { return null; } };

export default function InstallPrompt() {
  const [kind, setKind] = useState(null); // null | "native" | "ios"
  const deferred = useRef(null);
  const ready = useRef(false);   // delay has elapsed
  const shown = useRef(false);   // at most once per page load, even if storage is unavailable

  useEffect(() => {
    const evaluate = () => {
      if (!ready.current || shown.current) return;
      const k = decideOffer({ offered: wasOffered(store()), installed: isStandalone(), hasNativePrompt: !!deferred.current, isIOS: isIOSDevice() });
      if (!k) return;
      shown.current = true;
      markOffered(store()); // counted as offered the moment it appears, so ignoring it never brings it back
      setKind(k);
    };
    const onBeforeInstall = (e) => { e.preventDefault(); deferred.current = e; evaluate(); };
    const onInstalled = () => { deferred.current = null; setKind(null); markOffered(store()); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    const t = setTimeout(() => { ready.current = true; evaluate(); }, OFFER_DELAY_MS);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  useEffect(() => {
    if (!kind) return;
    const onKey = (e) => e.key === "Escape" && setKind(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);

  const install = async () => {
    const p = deferred.current;
    setKind(null);
    if (!p) return;
    deferred.current = null;
    try { p.prompt(); await p.userChoice; } catch { /* the browser dialog was unavailable or dismissed */ }
  };

  if (!kind) return null;
  return (
    <div role="region" aria-label="Install ToolDeck" className="note i"
      style={{ position: "fixed", bottom: 20, left: 20, right: 20, maxWidth: 420, margin: "0 auto", zIndex: 50, boxShadow: "0 10px 30px rgba(0,0,0,.2)" }}>
      <button type="button" className="rowcopy" aria-label="Close" onClick={() => setKind(null)}
        style={{ position: "absolute", top: 8, right: 8, fontSize: 14 }}>✕</button>
      <b>{kind === "ios" ? "Add ToolDeck to your Home Screen" : "Install ToolDeck"}</b>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--tx2)" }}>
        {kind === "ios"
          ? <>Tap <b>Share</b>, then <b>Add to Home Screen</b>, for a faster experience.</>
          : "Add to your home screen for a faster experience."}
      </p>
      {kind === "native" ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" onClick={install} style={{ flex: 1 }}>Install</button>
          <button type="button" className="btn gh" onClick={() => setKind(null)} style={{ flex: 1 }}>Not now</button>
        </div>
      ) : (
        <button type="button" className="btn gh" onClick={() => setKind(null)} style={{ marginTop: 10, width: "100%", fontSize: 12 }}>Got it</button>
      )}
    </div>
  );
}
