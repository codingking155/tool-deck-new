import { useState, useCallback } from "react";

async function sha1(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function checkBreached(password) {
  try {
    const hash = await sha1(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "ToolDeck-PasswordChecker/1.0" },
    });
    if (!response.ok) throw new Error("HIBP API unavailable");

    const text = await response.text();
    const lines = text.split("\r\n");
    for (const line of lines) {
      const [hashSuffix] = line.split(":");
      if (hashSuffix === suffix) return true;
    }
    return false;
  } catch (err) {
    return null; /* API error — can't check */
  }
}

function calculateEntropy(password) {
  if (!password) return { bits: 0, score: 0, strength: "No password" };

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z\d]/.test(password);

  let charset = 0;
  if (hasLower) charset += 26;
  if (hasUpper) charset += 26;
  if (hasDigit) charset += 10;
  if (hasSpecial) charset += 32;

  const bits = Math.log2(charset ** password.length);
  const score = Math.min(100, Math.round((bits / 128) * 100));

  let strength = "Very weak";
  if (bits >= 128) strength = "Very strong";
  else if (bits >= 80) strength = "Strong";
  else if (bits >= 60) strength = "Good";
  else if (bits >= 40) strength = "Fair";
  else if (bits >= 20) strength = "Weak";

  return { bits: Math.round(bits), score, strength };
}

export default function PasswordTool({ notify }) {
  const [password, setPassword] = useState("");
  const [entropy, setEntropy] = useState(null);
  const [breached, setBreached] = useState(null);
  const [checking, setChecking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);


  const handlePasswordChange = useCallback((e) => {
    const pwd = e.target.value;
    setPassword(pwd);
    if (pwd) {
      setEntropy(calculateEntropy(pwd));
      setBreached(null);
    } else {
      setEntropy(null);
      setBreached(null);
    }
  }, []);

  const handleCheck = useCallback(async () => {
    if (!password) return;
    setChecking(true);
    const result = await checkBreached(password);
    setBreached(result);
    if (result === true) {
      notify("⚠️ This password has been found in a data breach. Choose a different one.");
    } else if (result === false) {
      notify("✓ Not found in known breaches (yet tested)");
    } else {
      notify("⚠️ Could not check HIBP API. Try again later.");
    }
    setChecking(false);
  }, [password, notify]);

  return (
    <div className="tpage">
      <div className="grid2">
        <div className="panel">
          <div className="pb">
            <label htmlFor="pwd-input" className="label">Enter password to check</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                id="pwd-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Type your password here..."
                style={{ flex: 1 }}
                autoComplete="off"
              />
              <button
                className="btn gh"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "Hide password" : "Show password"}
                style={{ minWidth: "auto", padding: "8px 12px" }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <div style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 16 }}>
              Never stored. Checked locally and against a secure API using k-anonymity (only first 5 characters of the hash are sent).
            </div>

            {entropy && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>Entropy: {entropy.bits} bits</span>
                  <span style={{
                    fontWeight: 600,
                    color: entropy.score >= 80 ? "var(--good)" : entropy.score >= 60 ? "#EAAB00" : "var(--bad)"
                  }}>
                    {entropy.strength}
                  </span>
                </div>
                <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${entropy.score}%`,
                    height: "100%",
                    background: entropy.score >= 80 ? "var(--good)" : entropy.score >= 60 ? "#EAAB00" : "var(--bad)",
                    transition: "width 0.2s ease"
                  }} />
                </div>
              </div>
            )}

            <button
              onClick={handleCheck}
              disabled={!password || checking}
              className="btn"
              style={{ width: "100%", marginBottom: 12 }}
            >
              {checking ? "Checking..." : "Check Breaches"}
            </button>

            {breached === true && (
              <div className="note w">
                <b>⚠️ Unsafe password:</b> This password has appeared in at least one known data breach. Use a unique password instead.
              </div>
            )}
            {breached === false && (
              <div className="note g">
                <b>✓ Not breached:</b> This password hasn't been found in known public breaches (though it could still exist in unreleased data).
              </div>
            )}
            {breached === null && password && (
              <div className="note i">
                <b>Tip:</b> Click "Check Breaches" to verify against HIBP's database of 700+ million passwords from public breaches.
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="pb">
            <h3 style={{ marginTop: 0 }}>Password Strength Guide</h3>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--bad)" }}>⚠️ Very Weak (&lt;20 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Single character type, too short. Instantly cracked.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--bad)" }}>Weak (20–40 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Two character types or all mixed types but short. Cracked in hours.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "#EAAB00" }}>Fair (40–60 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, ~10–12 length. Cracked in days to weeks.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "#EAAB00" }}>Good (60–80 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, 13+ length. Practical safety for most users.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--good)" }}>Strong (80–100 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, 15+ length. Resists brute force for years.</div>
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--good)" }}>Very Strong (&gt;128 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>All character types, 16+ length or passphrase. Military-grade security.</div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, color: "var(--tx3)", lineHeight: 1.6 }}>
                <b>Best practices:</b> Use a password manager. Never reuse. Never share. 16+ characters beats complexity if you're tired.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
