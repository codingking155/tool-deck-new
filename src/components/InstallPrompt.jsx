import { Download, X } from "lucide-react";
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
    <div role="region" aria-label="Install ToolDeck" className="installp">
      <span className="ip-mark" aria-hidden="true"><Download size={18} /></span>
      <div className="ip-body">
        <b>{kind === "ios" ? "Add ToolDeck to your Home Screen" : "Install ToolDeck"}</b>
        <p>{kind === "ios"
          ? <>Tap <b>Share</b>, then <b>Add to Home Screen</b> — tools open instantly, even offline.</>
          : "Opens instantly from your home screen, even offline."}</p>
        {kind === "native" ? (
          <div className="actions">
            <button type="button" className="btn pri auto sm" onClick={install}>Install</button>
            <button type="button" className="btn qt sm" onClick={() => setKind(null)}>Not now</button>
          </div>
        ) : (
          <div className="actions"><button type="button" className="btn gh sm" onClick={() => setKind(null)}>Got it</button></div>
        )}
      </div>
      <button type="button" className="btn qt ico sm ip-x" aria-label="Close" onClick={() => setKind(null)}><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
