import { useState, useRef, useEffect } from "react";
import { checkEmail, checkPassword, isValidEmail } from "../lib/breach.js";
import { readParams, writeParams } from "../hooks/index.js";

const NEXT_STEPS = [
  "Change the password on every affected account — and anywhere you reused it.",
  "Use a unique password per site, ideally from a password manager.",
  "Turn on two-factor authentication, preferably an authenticator app or passkey.",
  "Be wary of phishing that mentions these services; attackers reuse breach data.",
];

function EmailPane({ notify }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ phase: "idle" });
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (e) => {
    e.preventDefault();
    const v = email.trim();
    if (!isValidEmail(v)) return notify("Enter a valid email address.");
    ctrl.current?.abort(); ctrl.current = new AbortController();
    setState({ phase: "loading" });
    try {
      const res = await checkEmail(v, ctrl.current.signal);
      setState({ phase: "done", res });
    } catch (err) {
      if (err?.name !== "AbortError") setState({ phase: "error", msg: err.message });
    }
  };

  const { phase, res, msg } = state;
  return (
    <div className="pb">
      <form onSubmit={run}>
        <input className="inp" style={{ height: 52, fontSize: 18 }} type="email" inputMode="email" autoComplete="off" spellCheck={false}
          placeholder="you@example.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={phase === "loading"}>{phase === "loading" ? "Checking…" : "Check this email"}</button>
      </form>

      {phase === "error" && <div className="note w" style={{ marginTop: 16 }}><b>Couldn't check · </b>{msg}</div>}

      {phase === "done" && res.breaches.length === 0 && (
        <div className="note i" style={{ marginTop: 16 }}>
          <b>No known breaches · </b>this address wasn't found in the breach database. That's good news, not a guarantee —
          new breaches appear all the time and no database is complete.
        </div>
      )}

      {phase === "done" && res.breaches.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="note w">
            <b>Found in {res.summary.count} breach{res.summary.count > 1 ? "es" : ""}</b>
            {res.summary.severe ? " — including sensitive data such as passwords or financial details." : "."}
          </div>
          {res.breaches.map((b) => (
            <div key={b.name + b.year} className="panel" style={{ marginTop: 10, padding: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <b>{b.name}</b>
                {b.year && <span style={{ color: "var(--tx3)", fontSize: 12 }}>{b.year}</span>}
                {b.domain && <span style={{ color: "var(--tx3)", fontSize: 12 }}>{b.domain}</span>}
                {b.severe && <span style={{ color: "var(--bad)", fontSize: 12, fontWeight: 600 }}>SENSITIVE</span>}
              </div>
              {b.dataTypes.length > 0 && <div style={{ fontSize: 13, marginTop: 6 }}><span style={{ color: "var(--tx3)" }}>Exposed: </span>{b.dataTypes.join(", ")}</div>}
              {b.records != null && <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 2 }}>{b.records.toLocaleString()} accounts in this breach</div>}
              {b.description && <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 6 }}>{b.description}</div>}
            </div>
          ))}
          <div className="note i" style={{ marginTop: 14 }}>
            <b>What to do next</b>
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{NEXT_STEPS.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        </div>
      )}
      <div className="note i" style={{ marginTop: 16 }}>
        <b>Privacy · </b>your email is sent once to our server, which asks the XposedOrNot breach database and returns the result.
        It isn't stored or logged. Only check addresses you own.
      </div>
    </div>
  );
}

function PasswordPane({ notify }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState({ phase: "idle" });
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (e) => {
    e.preventDefault();
    if (!pw) return notify("Enter a password to check.");
    ctrl.current?.abort(); ctrl.current = new AbortController();
    setState({ phase: "loading" });
    try {
      setState({ phase: "done", n: await checkPassword(pw, ctrl.current.signal) });
    } catch (err) {
      if (err?.name !== "AbortError") setState({ phase: "error", msg: err.message });
    }
  };

  const { phase, n, msg } = state;
  return (
    <div className="pb">
      <form onSubmit={run}>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="inp" style={{ height: 52, fontSize: 18, flex: 1 }} type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
            placeholder="Password to check" aria-label="Password" value={pw} onChange={(e) => { setPw(e.target.value); setState({ phase: "idle" }); }} />
          <button type="button" className="btn gh" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
        </div>
        <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={phase === "loading"}>{phase === "loading" ? "Checking…" : "Check this password"}</button>
      </form>

      {phase === "error" && <div className="note w" style={{ marginTop: 16 }}><b>Couldn't check · </b>{msg}</div>}
      {phase === "done" && n > 0 && (
        <div className="note w" style={{ marginTop: 16 }}>
          <b>Seen {n.toLocaleString()} time{n > 1 ? "s" : ""} in breaches · </b>don't use this password anywhere. Attackers try known passwords first.
        </div>
      )}
      {phase === "done" && n === 0 && (
        <div className="note i" style={{ marginTop: 16 }}>
          <b>Not found in known breaches · </b>that doesn't make it strong — length and uniqueness still matter.
        </div>
      )}
      <div className="note i" style={{ marginTop: 16 }}>
        <b>Privacy · </b>your password never leaves your browser. We hash it locally and send only the first 5 characters of that hash to
        Have I Been Pwned's Pwned Passwords service (k-anonymity), then match the rest here.
      </div>
    </div>
  );
}

export default function BreachTool({ notify }) {
  const [tab, setTab] = useState(() => (readParams().get("m") === "password" ? "password" : "email"));
  useEffect(() => { writeParams({ m: tab === "password" ? "password" : null }); }, [tab]);
  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      <div className="modes" role="tablist">
        <button role="tab" aria-selected={tab === "email"} className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>Email breach check</button>
        <button role="tab" aria-selected={tab === "password"} className={tab === "password" ? "on" : ""} onClick={() => setTab("password")}>Password check</button>
      </div>
      <div className="panel rise d1">
        <div className="ph">
          {tab === "email"
            ? <><h3>Has your email been in a data breach?</h3><p>Checks the XposedOrNot database and shows what was exposed.</p></>
            : <><h3>Has your password been leaked?</h3><p>Checks Have I Been Pwned's Pwned Passwords without sending your password.</p></>}
        </div>
        {tab === "email" ? <EmailPane notify={notify} /> : <PasswordPane notify={notify} />}
      </div>
    </div>
  );
}
