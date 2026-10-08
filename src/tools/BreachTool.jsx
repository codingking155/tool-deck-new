import { useState, useRef, useEffect } from "react";
import { Mail, KeyRound, ShieldCheck, AlertTriangle, Loader2, RotateCcw, ArrowRight, Server, Database, Laptop, Hash, Eye, EyeOff, CalendarDays, Users, Globe, CircleCheck, BadgeCheck } from "lucide-react";
import { checkEmail, checkPassword, isValidEmail, isSevereType, nextSteps } from "../lib/breach.js";
import { readParams, writeParams } from "../hooks/index.js";
import { Notice, StatusBadge } from "../components/ui.jsx";
import "./css/breach.css";

/* Error message → which kind of failure, so "not set up here", "slow down" and "offline" read differently. */
function classify(msg) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { tone: "off", title: "You're offline", hint: "Reconnect and try again — what you entered is still here." };
  if (/isn't configured/i.test(msg)) return { tone: "off", title: "Not available on this deployment", hint: null, noRetry: true };
  if (/429|rate.?limit|too many/i.test(msg)) return { tone: "w", title: "Too many checks right now", hint: "Wait a minute, then try again." };
  return { tone: "w", title: "Couldn't check right now", hint: "The breach service didn't answer. Try again in a moment." };
}

const secsLeft = (until) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

/* Live "Try again in Ns". Ticks in its own leaf so only this text re-renders; onDone fires once at 0.
   aria-live="off" so the enclosing alert isn't re-announced every second. */
function Countdown({ until, onDone }) {
  const [left, setLeft] = useState(() => secsLeft(until));
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    const id = setInterval(() => {
      const s = secsLeft(until);
      setLeft(s);
      if (s <= 0) { clearInterval(id); done.current?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return <span aria-live="off">{left > 0 ? `Try again in ${left}s.` : "You can try again now."}</span>;
}

/* retryUntil (epoch ms) comes from a 429's retryAfter; while cooling the retry button stays disabled. */
function ErrorNotice({ msg, onRetry, retryUntil, cooling, onCooldownEnd }) {
  const c = classify(msg);
  return (
    <Notice tone={c.tone} title={c.title} role="alert" className="br-gap"
      actions={!c.noRetry && <button type="button" className="btn gh sm" onClick={onRetry} disabled={cooling}><RotateCcw size={14} aria-hidden="true" />Try again</button>}>
      {retryUntil ? <Countdown until={retryUntil} onDone={onCooldownEnd} />
        : <>{msg}{c.hint && msg !== c.hint ? <> {c.hint}</> : null}</>}
    </Notice>
  );
}

/* "Where it goes", drawn as a short flow right next to the input that sends it. */
function DataFlow({ steps, children }) {
  return (
    <div className="br-flow">
      <ol className="br-steps" aria-label="Where your input goes">
        {steps.map(([Icon, label], i) => (
          <li key={label}>{i > 0 && <ArrowRight size={13} className="br-arr" aria-hidden="true" />}<Icon size={14} aria-hidden="true" /><span>{label}</span></li>
        ))}
      </ol>
      <p>{children}</p>
    </div>
  );
}

function Verdict({ tone, Icon, title, children }) {
  return (
    <div className={`br-verdict br-t-${tone}`}>
      <span className="br-ic" aria-hidden="true"><Icon size={20} strokeWidth={2.2} /></span>
      <div className="br-vb"><h3>{title}</h3>{children && <p>{children}</p>}</div>
    </div>
  );
}

function EmailPane({ notify }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ phase: "idle" });
  const [coolUntil, setCoolUntil] = useState(null); // epoch ms; set by a 429 with retryAfter
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (e) => {
    e?.preventDefault();
    if (coolUntil) return;
    const v = email.trim();
    if (!isValidEmail(v)) return notify("Enter a valid email address.");
    ctrl.current?.abort(); ctrl.current = new AbortController();
    setState({ phase: "loading" });
    try {
      const res = await checkEmail(v, ctrl.current.signal);
      setState({ phase: "done", res });
    } catch (err) {
      if (err?.name === "AbortError") return;
      const retryUntil = err?.status === 429 && err.retryAfter ? Date.now() + err.retryAfter * 1000 : null;
      setCoolUntil(retryUntil);
      setState({ phase: "error", msg: err.message, retryUntil });
    }
  };

  const { phase, res, msg, retryUntil } = state;
  const count = res ? res.summary?.count ?? res.breaches.length : 0;
  const exposed = res?.summary?.dataTypes ?? [];
  return (
    <div className="pb">
      <form onSubmit={run} noValidate>
        <div className="field br-field">
          <label htmlFor="br-email">Email address</label>
          <div className="inrow stack">
            <input id="br-email" type="email" inputMode="email" autoComplete="off" spellCheck={false}
              placeholder="you@example.com" value={email}
              onChange={(e) => { setEmail(e.target.value); if (phase === "loading") { ctrl.current?.abort(); setState({ phase: "idle" }); } }} />
            <button className="btn pri auto" disabled={phase === "loading" || !!coolUntil}>
              {phase === "loading" && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {phase === "loading" ? "Checking…" : "Check this email"}
            </button>
          </div>
        </div>
      </form>
      <DataFlow steps={[[Mail, "Your email"], [Server, "ToolDeck server"], [Database, "Breach database"]]}>
        Your email is sent once to our server, which asks a public breach database and returns the result.
        It isn't stored or logged. Only check addresses you own.
      </DataFlow>

      <div aria-live="polite" aria-busy={phase === "loading"}>
        {phase === "error" && <ErrorNotice msg={msg} onRetry={() => run()} retryUntil={retryUntil} cooling={!!coolUntil} onCooldownEnd={() => setCoolUntil(null)} />}

        {phase === "done" && res.breaches.length === 0 && (
          <Verdict tone="ok" Icon={ShieldCheck} title="No known breaches">
            This address wasn't found in the breach database. That's good news, not a guarantee —
            new breaches appear all the time and no database is complete.
          </Verdict>
        )}

        {phase === "done" && res.breaches.length > 0 && (
          <>
            <Verdict tone="warn" Icon={AlertTriangle} title={`Found in ${count} breach${count > 1 ? "es" : ""}`}>
              {res.summary?.severe ? "Including sensitive data such as passwords or financial details." : "Here's what was exposed and where."}
            </Verdict>
            {exposed.length > 0 && (
              <section className="br-all" aria-labelledby="br-all-h">
                <h3 id="br-all-h">Exposed overall</h3>
                <div className="br-types">
                  {exposed.map((t) => isSevereType(t)
                    ? <span key={t} className="chip br-sev"><AlertTriangle size={12} aria-hidden="true" /><span className="sr-only">Sensitive: </span>{t}</span>
                    : <span key={t} className="chip">{t}</span>)}
                </div>
              </section>
            )}
            <ul className="br-list">
              {res.breaches.map((b, i) => (
                // index keeps keys unique: two records can share name + year (or both lack a year)
                <li key={`${i}:${b.name}`} className="br-item">
                  <div className="br-top">
                    <b className="br-name">{b.name}</b>
                    {b.severe && <StatusBadge tone="warn" icon={AlertTriangle}>SENSITIVE</StatusBadge>}
                    {b.verified && <StatusBadge tone="info" icon={BadgeCheck} title="The breach database has confirmed this breach is genuine">VERIFIED</StatusBadge>}
                  </div>
                  <div className="br-meta">
                    {b.year && <span><CalendarDays size={13} aria-hidden="true" />{b.year}</span>}
                    {b.domain && <span className="br-dom"><Globe size={13} aria-hidden="true" />{b.domain}</span>}
                    {b.records != null && <span><Users size={13} aria-hidden="true" />{b.records.toLocaleString()} accounts in this breach</span>}
                  </div>
                  {b.dataTypes?.length > 0 && (
                    <div className="br-types"><span className="sr-only">Exposed: </span>
                      {b.dataTypes.map((t) => <span key={t} className="chip">{t}</span>)}
                    </div>
                  )}
                  {b.description && <p className="br-desc">{b.description}</p>}
                </li>
              ))}
            </ul>
            <section className="br-next" aria-labelledby="br-next-h">
              <h3 id="br-next-h">What to do next</h3>
              <ul>{nextSteps(exposed.length ? exposed : res.breaches.flatMap((b) => b.dataTypes ?? [])).map((s) => <li key={s}><CircleCheck size={15} aria-hidden="true" />{s}</li>)}</ul>
            </section>
          </>
        )}
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
    e?.preventDefault();
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
      <form onSubmit={run} noValidate>
        <div className="field br-field">
          <label htmlFor="br-pw">Password</label>
          <div className="inrow stack">
            <div className="br-pwrow">
              <input id="br-pw" type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
                placeholder="Password to check" value={pw} onChange={(e) => { ctrl.current?.abort(); setPw(e.target.value); setState({ phase: "idle" }); }} />
              {/* named by its text, not aria-label, so "Password" keeps labelling exactly one field */}
              <button type="button" className="btn gh br-eye" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls="br-pw">
                {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{show ? "Hide" : "Show"}
              </button>
            </div>
            <button className="btn pri auto" disabled={phase === "loading"}>
              {phase === "loading" && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {phase === "loading" ? "Checking…" : "Check this password"}
            </button>
          </div>
        </div>
      </form>
      <DataFlow steps={[[Laptop, "Hashed on this device"], [Hash, "First 5 hash characters"], [Database, "Breach database"]]}>
        Your password never leaves your browser. We hash it locally and send only the first 5 characters of that hash to
        a leaked-password database (k-anonymity), then match the rest here.
      </DataFlow>

      <div aria-live="polite" aria-busy={phase === "loading"}>
        {phase === "error" && <ErrorNotice msg={msg} onRetry={() => run()} />}
        {phase === "done" && n > 0 && (
          <Verdict tone="warn" Icon={AlertTriangle} title={`Seen ${n.toLocaleString()} time${n > 1 ? "s" : ""} in breaches`}>
            Don't use this password anywhere. Attackers try known passwords first.
          </Verdict>
        )}
        {phase === "done" && n === 0 && (
          <Verdict tone="ok" Icon={ShieldCheck} title="Not found in known breaches">
            That doesn't make it strong — length and uniqueness still matter.
          </Verdict>
        )}
      </div>
    </div>
  );
}

export default function BreachTool({ notify }) {
  const [tab, setTab] = useState(() => (readParams().get("m") === "password" ? "password" : "email"));
  useEffect(() => { writeParams({ m: tab === "password" ? "password" : null }); }, [tab]);
  return (
    <div className="br">
      <div className="seg br-seg" role="group" aria-label="Check type">
        <button type="button" aria-pressed={tab === "email"} onClick={() => setTab("email")}><Mail size={15} aria-hidden="true" />Email breach check</button>
        <button type="button" aria-pressed={tab === "password"} onClick={() => setTab("password")}><KeyRound size={15} aria-hidden="true" />Password check</button>
      </div>
      <div className="panel">
        <div className="ph">
          {tab === "email"
            ? <><h2>Has your email been in a data breach?</h2><p>Checks a public breach database and shows what was exposed.</p></>
            : <><h2>Has your password been leaked?</h2><p>Checks a leaked-password database without sending your password.</p></>}
        </div>
        {tab === "email" ? <EmailPane notify={notify} /> : <PasswordPane notify={notify} />}
      </div>
    </div>
  );
}
