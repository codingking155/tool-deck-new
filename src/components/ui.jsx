import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Server, Globe2, SplitSquareHorizontal, Copy, Check, Info, AlertTriangle, OctagonAlert, CircleCheck, WifiOff, FlaskConical } from "lucide-react";
import { WHERE_LABEL, BETA_HINT } from "../toolsMeta.js";

/* Small, deliberately un-generic building blocks shared by the shell and the tools.
   Styling lives in styles.css (section 5); these only add structure + behaviour. */

const WHERE_ICON = { device: ShieldCheck, tooldeck: Server, external: Globe2, mixed: SplitSquareHorizontal };

/** Where a tool's input is processed — label + icon, explanation on hover/focus and for screen readers. */
export function PrivacyBadge({ where }) {
  const meta = WHERE_LABEL[where];
  if (!meta) return null;
  const Icon = WHERE_ICON[where];
  return (
    <span className={`pbadge ${where}`} title={meta[1]} aria-label={`${meta[0]}: ${meta[1]}`} role="img">
      <Icon aria-hidden="true" strokeWidth={2.2} />{meta[0]}
    </span>
  );
}

export function BetaBadge() {
  return <span className="betabadge" title={BETA_HINT}>Beta</span>;
}

const TONE_ICON = { i: Info, w: AlertTriangle, e: OctagonAlert, ok: CircleCheck, off: WifiOff, beta: FlaskConical };

/** Inline notice: icon + optional bold title + body + optional actions. tone: i | w | e | ok | off */
export function Notice({ tone = "i", title, children, actions, role, className = "" }) {
  const Icon = TONE_ICON[tone] || Info;
  const cls = tone === "off" ? "w" : tone;
  return (
    <div className={`note notice ${cls} ${className}`} role={role || (tone === "e" ? "alert" : undefined)}>
      <Icon size={16} aria-hidden="true" strokeWidth={2.2} />
      <div className="nb">
        {title && <b>{title}</b>}
        {children}
        {actions && <div className="na">{actions}</div>}
      </div>
    </div>
  );
}

/** Status pill — tone: ok | warn | bad | info | brand | (neutral). Always text, optionally an icon. */
export function StatusBadge({ tone = "", icon: Icon, children, title }) {
  return <span className={`badge ${tone}`} title={title}>{Icon && <Icon aria-hidden="true" strokeWidth={2.4} />}{children}</span>;
}

/** Copy → ✓ Copied → back. Inline confirmation, plus the global toast if `notify` is given. */
export function CopyButton({ text, label = "Copy", done = "Copied", notify, toast, className = "btn gh", disabled, icon = true, title }) {
  const [ok, setOk] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const run = async () => {
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
      setOk(true); clearTimeout(t.current); t.current = setTimeout(() => setOk(false), 1600);
      if (notify && toast) notify(toast);
    } catch { notify && notify("Couldn't copy — select and copy manually."); }
  };
  return (
    <button type="button" className={`${className} ${ok ? "is-done" : ""}`} onClick={run} disabled={disabled} title={title} aria-live="polite">
      {icon && (ok ? <Check size={15} className="tick" aria-hidden="true" strokeWidth={2.6} /> : <Copy size={15} aria-hidden="true" />)}
      {ok ? done : label}
    </button>
  );
}

/** Empty state: what this is, why it's empty, what to do. */
export function EmptyState({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty-st">
      {Icon && <span className="eic" aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>}
      {title && <b>{title}</b>}
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Headline number with label — tabular, optional unit. */
export function Metric({ label, value, unit, tone }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className={`v ${tone ? `${tone}-tx` : ""}`}>{value}{unit && <small>{unit}</small>}</div>
    </div>
  );
}

/** Classifies a thrown error / failed response into a human explanation + recovery hint. */
export function describeError(err, { service = "the service" } = {}) {
  const msg = String(err?.message || err || "");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline", title: "You're offline", hint: "Reconnect and try again — what you entered is still here." };
  if (/429|rate.?limit|too many/i.test(msg)) return { kind: "rate", title: "Too many requests", hint: "Wait a minute, then try again." };
  if (/failed to fetch|networkerror|load failed|timeout|timed out|abort/i.test(msg)) return { kind: "network", title: `Couldn't reach ${service}`, hint: "Check your connection or try again shortly." };
  if (/5\d\d|server/i.test(msg)) return { kind: "server", title: `${service[0].toUpperCase()}${service.slice(1)} had a problem`, hint: "It's not you — try again in a moment." };
  return { kind: "unknown", title: "That didn't work", hint: "Try again. If it keeps happening, the detail below helps us fix it." };
}
