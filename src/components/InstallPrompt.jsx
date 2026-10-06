import { useEffect, useState } from "react";

export default function InstallPrompt() {
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isInStandaloneMode = window.navigator.standalone === true;

    if (isIOS && !isInStandaloneMode) {
      const lastDismissed = localStorage.getItem("toolDeck.install-prompt-dismissed");
      const lastDismissedTime = lastDismissed ? parseInt(lastDismissed) : 0;
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (Date.now() - lastDismissedTime > oneDayMs) {
        setShowIOSPrompt(true);
      }
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const handleDismiss = () => {
    setShowIOSPrompt(false);
    localStorage.setItem("toolDeck.install-prompt-dismissed", String(Date.now()));
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setDeferredPrompt(null);
    handleDismiss();
  };

  if (!showIOSPrompt && !deferredPrompt) return null;

  return (
    <div
      className="note i"
      style={{
        position: "fixed",
        bottom: "20px",
        left: "20px",
        right: "20px",
        maxWidth: "420px",
        margin: "0 auto",
        zIndex: 50,
        boxShadow: "0 10px 30px rgba(0,0,0,.2)",
      }}
    >
      {showIOSPrompt && (
        <div>
          <b>Add ToolDeck to Home Screen</b>
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--tx2)" }}>
            Tap <code style={{ background: "rgba(77,214,200,.1)", padding: "1px 4px", borderRadius: "3px" }}>Share</code> → <code style={{ background: "rgba(77,214,200,.1)", padding: "1px 4px", borderRadius: "3px" }}>Add to Home Screen</code> for quick access.
          </p>
          <button
            className="btn gh"
            onClick={handleDismiss}
            style={{ marginTop: "10px", width: "100%", fontSize: "12px" }}
          >
            Got it
          </button>
        </div>
      )}
      {deferredPrompt && !showIOSPrompt && (
        <div>
          <b>Install ToolDeck</b>
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--tx2)" }}>
            Add to your home screen for a faster experience.
          </p>
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button className="btn gh" onClick={handleInstall} style={{ flex: 1 }}>
              Install
            </button>
            <button className="btn gh" onClick={handleDismiss} style={{ flex: 1 }}>
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
