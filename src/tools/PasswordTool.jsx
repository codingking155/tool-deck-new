import { useState, useCallback, useRef, useEffect } from "react";
import { Eye, EyeOff, ShieldCheck, ShieldAlert, Shield, ShieldQuestion, CircleCheck, AlertTriangle, Loader2, KeyRound, Lock, Search, Lightbulb } from "lucide-react";
import { checkPassword } from "../lib/breach.js";
import { EmptyState } from "../components/ui.jsx";
import "./css/password.css";

/* One tone per strength band, shared by the meter and the guide (icon + words always ride along). */
const BANDS = [
  ["Very weak", "bad", "<20 bits", "Single character type, too short. Instantly cracked."],
  ["Weak", "bad", "20–40 bits", "Two character types or all mixed types but short. Cracked in hours."],
  ["Fair", "warn", "40–60 bits", "Mixed characters, ~10–12 length. Cracked in days to weeks."],
  ["Good", "warn", "60–80 bits", "Mixed characters, 13+ length. Practical safety for most users."],
  ["Strong", "good", "80–128 bits", "Mixed characters, 15+ length. Resists brute force for years."],
  ["Very strong", "good", "128+ bits", "All character types, 16+ length or passphrase. Out of reach of brute force."],
];
const TONE_ICON = { bad: ShieldAlert, warn: Shield, good: ShieldCheck };

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

/* Local, display-only pattern checks. Entropy alone over-rates "aaaaaaaaaaaa" or "abc123abc123". */
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz", "0123456789"];
function hasSequence(pw) {
  const s = pw.toLowerCase();
  for (let i = 0; i + 3 <= s.length; i++) {
    const tri = s.slice(i, i + 3);
    const rev = [...tri].reverse().join("");
    if (ROWS.some((r) => r.includes(tri) || r.includes(rev))) return true;
  }
  return false;
}
function analyse(pw) {
  const types = [[/[a-z]/, "lowercase"], [/[A-Z]/, "uppercase"], [/\d/, "digits"], [/[^a-zA-Z\d]/, "symbols"]].filter(([re]) => re.test(pw)).map(([, n]) => n);
  const len = pw.length;
  return [
    { key: "len", ok: len >= 12, text: len >= 12 ? `${len} characters long` : `Only ${len} character${len === 1 ? "" : "s"} — 12 or more recommended` },
    { key: "mix", ok: types.length >= 3, text: `Uses ${types.length} of 4 character types (${types.join(", ")})` },
    { key: "rep", ok: !/(.)\1\1/.test(pw), text: /(.)\1\1/.test(pw) ? "Repeats a character 3+ times in a row" : "No runs of repeated characters" },
    { key: "seq", ok: !hasSequence(pw), text: hasSequence(pw) ? "Contains a sequence like “abc”, “123” or “qwe”" : "No obvious sequences or keyboard runs" },
  ];
}
function recommend(checks, band, breach) {
  const out = [];
  if (breach === "found") out.push("Don't use this password anywhere — it's on attackers' lists.");
  if (!checks.find((c) => c.key === "len").ok || band < 4) out.push("Make it longer: 16+ characters, or a passphrase of 4–5 random words.");
  if (!checks.find((c) => c.key === "mix").ok) out.push("Mix in more character types — uppercase, digits or symbols.");
  if (!checks.find((c) => c.key === "rep").ok || !checks.find((c) => c.key === "seq").ok) out.push("Avoid repeats, sequences and keyboard patterns; attackers try them first.");
  out.push("Use a password manager. Never reuse a password across sites. Never share it.");
  return out;
}

/* Breach-check states (k-anonymity lookup) */
const BREACH_VIEW = {
  idle: { tone: "idle", Icon: ShieldQuestion, title: "Not checked yet", sub: "Run the breach check to compare against 700+ million breached passwords." },
  checking: { tone: "idle", Icon: Loader2, title: "Checking…", sub: "Sending 5 characters of the hash to the breach database." },
  found: { tone: "warn", Icon: AlertTriangle, title: "Found in known breaches", sub: "This password has appeared in at least one known data breach. Use a unique password instead." },
  clear: { tone: "good", Icon: CircleCheck, title: "Not found in known breaches", sub: "Not in known public breaches (it could still exist in unreleased data)." },
  unavailable: { tone: "warn", Icon: AlertTriangle, title: "Couldn't check right now", sub: "The breach database didn't answer. Try again later." },
};

function BreachStatus({ status, count }) {
  const v = BREACH_VIEW[status];
  const title = status === "found" && count > 0 ? `Seen ${count.toLocaleString()} time${count > 1 ? "s" : ""} in breaches` : v.title;
  return (
    <div className={`pw-breach pw-t-${v.tone}`} aria-live="polite">
      <span className="pw-bic" aria-hidden="true"><v.Icon size={18} className={status === "checking" ? "spin" : undefined} /></span>
      <div className="pw-bb">
        <div className="pw-bk">Breach check · leaked passwords</div>
        <b>{title}</b>
        <p>{v.sub}</p>
      </div>
    </div>
  );
}

function StrengthMeter({ entropy }) {
  const idx = Math.max(0, BANDS.findIndex(([n]) => n === entropy.strength));
  const [, tone, , context] = BANDS[idx];
  const Icon = TONE_ICON[tone];
  return (
    <div className={`pw-str pw-t-${tone}`}>
      <div className="pw-str-top">
        <div>
          <div className="eyebrow">Strength</div>
          <div className="pw-str-v" aria-live="polite"><Icon size={22} aria-hidden="true" strokeWidth={2.2} />{entropy.strength}</div>
        </div>
        <div className="pw-bits"><b>{entropy.bits}</b><small>bits of entropy</small></div>
      </div>
      <div className="pw-seg" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={128}
        aria-valuenow={Math.min(128, entropy.bits)} aria-valuetext={`${entropy.strength}, ${entropy.bits} bits`}>
        {BANDS.map(([n], i) => <i key={n} className={i <= idx ? "on" : ""} />)}
      </div>
      <p className="pw-ctx">{context}</p>
    </div>
  );
}

export default function PasswordTool({ notify }) {
  const [password, setPassword] = useState("");
  const [entropy, setEntropy] = useState(null);
  const [breach, setBreach] = useState("idle");   // idle | checking | found | clear | unavailable
  const [breachCount, setBreachCount] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const handlePasswordChange = useCallback((e) => {
    const pwd = e.target.value;
    ctrl.current?.abort(); ctrl.current = null; // a result for the previous password must never show for this one
    setPassword(pwd);
    setEntropy(pwd ? calculateEntropy(pwd) : null);
    setBreach("idle");
  }, []);

  const handleCheck = useCallback(async () => {
    if (!password) return;
    ctrl.current?.abort();
    const mine = (ctrl.current = new AbortController());
    setBreach("checking");
    let result;
    let count = 0;
    try { count = await checkPassword(password, mine.signal); result = count > 0; }
    catch (err) { if (err?.name === "AbortError") return; result = null; }
    if (ctrl.current !== mine) return;
    setBreachCount(result ? count : 0);
    setBreach(result === true ? "found" : result === false ? "clear" : "unavailable");
    if (result === true) {
      notify(`⚠️ This password has been seen ${count.toLocaleString()} time${count > 1 ? "s" : ""} in data breaches. Choose a different one.`);
    } else if (result === false) {
      notify("✓ Not found in known breaches");
    } else {
      notify("⚠️ Could not run the breach check. Try again later.");
    }
  }, [password, notify]);

  const checks = password ? analyse(password) : [];
  const band = entropy ? Math.max(0, BANDS.findIndex(([n]) => n === entropy.strength)) : 0;
  const checking = breach === "checking";

  return (
    <div className="grid2 pw">
      <div className="panel">
        <div className="pb">
          <div className="field">
            <label htmlFor="pwd-input">Password to check</label>
            <div className="inrow">
              <input
                id="pwd-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter a password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby="pwd-privacy"
              />
              <button type="button" className="btn gh pw-eye" onClick={() => setShowPassword((v) => !v)}
                aria-label="Show password" aria-pressed={showPassword} aria-controls="pwd-input">
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                <span aria-hidden="true">{showPassword ? "Hide" : "Show"}</span>
              </button>
            </div>
          </div>

          <p className="pw-priv" id="pwd-privacy">
            <Lock size={15} aria-hidden="true" />
            <span><b>Your password never leaves this device;</b> breach check sends only 5 characters of its hash.</span>
          </p>

          <button type="button" onClick={handleCheck} disabled={!password || checking} className="btn pri">
            {checking ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            {checking ? "Checking…" : "Check breaches"}
          </button>

          <details className="more">
            <summary>How strength is rated</summary>
            <ul className="pw-guide">
              {BANDS.map(([n, tone, range, desc]) => {
                const I = TONE_ICON[tone];
                return (
                  <li key={n} className={`pw-t-${tone}`}>
                    <I size={15} aria-hidden="true" />
                    <div><b>{n}</b> <span className="pw-range">{range}</span><p>{desc}</p></div>
                  </li>
                );
              })}
            </ul>
            <p className="hint">Entropy assumes every character is random. Words, names and patterns are far easier to guess than the number suggests — the checks catch the common ones.</p>
          </details>
        </div>
      </div>

      <div className="panel sticky pw-res">
        <div className="pb">
          {!entropy ? (
            <EmptyState icon={KeyRound} title="Type a password to rate it">
              Strength, pattern checks and advice update as you type. Nothing is stored or sent until you run the breach check.
            </EmptyState>
          ) : (
            <>
              <StrengthMeter entropy={entropy} />

              <h3 className="pw-h3">Checks</h3>
              <ul className="pw-checks">
                {checks.map((c) => (
                  <li key={c.key} className={c.ok ? "ok" : "warn"}>
                    {c.ok ? <CircleCheck size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                    <span><span className="sr-only">{c.ok ? "Pass: " : "Warning: "}</span>{c.text}</span>
                  </li>
                ))}
              </ul>

              <BreachStatus status={breach} count={breachCount} />

              <h3 className="pw-h3">Recommendations</h3>
              <ul className="pw-recs">
                {recommend(checks, band, breach).map((r) => <li key={r}><Lightbulb size={15} aria-hidden="true" />{r}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
