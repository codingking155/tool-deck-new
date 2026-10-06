import { useState, useCallback, useRef, useEffect } from "react";
import { checkPassword } from "../lib/breach.js";

/* One colour per strength band, shared by the meter and the guide. */
const TONE = { "Very weak": "var(--bad)", Weak: "var(--bad)", Fair: "var(--warn)", Good: "var(--warn)", Strong: "var(--good)", "Very strong": "var(--good)" };

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

  const bits = password.length * Math.log2(charset); // log2(charset ** length) overflows to Infinity for long passwords
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
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const handlePasswordChange = useCallback((e) => {
    const pwd = e.target.value;
    ctrl.current?.abort(); ctrl.current = null; // a result for the previous password must never show for this one
    setChecking(false);
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
    ctrl.current?.abort();
    const mine = (ctrl.current = new AbortController());
    setChecking(true);
    let result;
    try { result = (await checkPassword(password, mine.signal)) > 0; }
    catch (err) { if (err?.name === "AbortError") return; result = null; }
    if (ctrl.current !== mine) return;
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
    <div>
      <div className="grid2">
        <div className="panel">
          <div className="pb">
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="pwd-input">Password to check</label></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                id="pwd-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter a password"
                className="inp"
                style={{ flex: 1, minWidth: 0 }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn gh"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={`${showPassword ? "Hide" : "Show"} password`}
                style={{ flexShrink: 0, padding: "0 14px" }}
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
                    color: TONE[entropy.strength]
                  }}>
                    {entropy.strength}
                  </span>
                </div>
                <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${entropy.score}%`,
                    height: "100%",
                    background: TONE[entropy.strength],
                    transition: "width 0.2s ease"
                  }} />
                </div>
              </div>
            )}

            <button
              onClick={handleCheck}
              disabled={!password || checking}
              className="btn pri"
              style={{ marginBottom: 12 }}
            >
              {checking ? "Checking..." : "Check Breaches"}
            </button>

            {breached === true && (
              <div className="note w">
                <b>⚠️ Unsafe password:</b> This password has appeared in at least one known data breach. Use a unique password instead.
              </div>
            )}
            {breached === false && (
              <div className="note ok">
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
            <h2 style={{ marginTop: 0 }}>Password Strength Guide</h2>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE["Very weak"] }}>⚠️ Very Weak (&lt;20 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Single character type, too short. Instantly cracked.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE.Weak }}>Weak (20–40 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Two character types or all mixed types but short. Cracked in hours.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE.Fair }}>Fair (40–60 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, ~10–12 length. Cracked in days to weeks.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE.Good }}>Good (60–80 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, 13+ length. Practical safety for most users.</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE.Strong }}>Strong (80–128 bits)</div>
              <div style={{ fontSize: 13, color: "var(--tx3)" }}>Mixed characters, 15+ length. Resists brute force for years.</div>
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8, color: TONE["Very strong"] }}>Very Strong (128+ bits)</div>
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
