import { useState, useRef, useEffect } from "react";
import { ShieldCheck, ShieldX, ShieldAlert, Search, Loader2, RotateCcw, ExternalLink, Lock, CalendarClock, CircleCheck, AlertTriangle, OctagonAlert, HelpCircle } from "lucide-react";
import { normalizeDomain, parseDate, daysUntil, expirySeverity } from "../../shared/sslCore/index.mjs";
import { Notice, EmptyState } from "../components/ui.jsx";
import "./css/ssl.css";

/* Talks to our `ssl-check` edge function: a real TLS handshake to host:443 plus the
   latest valid certificate for the name from Certificate Transparency (crt.sh). */

const TIMEOUT_MS = 25_000;
const SAN_PREVIEW = 8;

const TLS_TITLE = {
  valid: "Trusted and currently valid",
  expired: "Certificate expired",
  not_yet_valid: "Certificate not valid yet",
  hostname_mismatch: "Certificate doesn't match this name",
  untrusted: "Untrusted certificate chain",
  revoked: "Certificate revoked",
  unreachable: "Couldn't connect",
  handshake_failed: "TLS handshake failed",
  error: "TLS connection failed",
};
/* connection-level failures say nothing about the certificate itself — calm warn, not "invalid" */
const CONN_FAIL = new Set(["unreachable", "handshake_failed", "error"]);
/* expiry severity → tone + icon (icon + words always accompany the colour) */
const SEV = {
  expired: { tone: "bad", Icon: OctagonAlert },
  critical: { tone: "bad", Icon: OctagonAlert },
  warning: { tone: "warn", Icon: AlertTriangle },
  ok: { tone: "good", Icon: CircleCheck },
  unknown: { tone: "", Icon: HelpCircle },
};

const fmtDate = (iso) => {
  const t = parseDate(iso);
  return t == null ? "—" : new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

async function fetchSslCheck(host, signal) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("The SSL check isn't configured on this deployment.");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let r;
  try {
    r = await fetch(`${base}/functions/v1/ssl-check?host=${encodeURIComponent(host)}`, {
      signal, headers: { Accept: "application/json", ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Couldn't reach the SSL check service. Check your connection and try again.");
  }
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.tls) throw new Error(body?.error?.message || "Unable to check right now. Please try again.");
  return body;
}

function Verdict({ tls, host }) {
  const tone = tls.ok ? "ok" : CONN_FAIL.has(tls.status) ? "warn" : "bad";
  const Icon = tls.ok ? ShieldCheck : tone === "warn" ? ShieldAlert : ShieldX;
  const title = tls.ok ? "Valid certificate" : tone === "warn" ? "Couldn't verify the certificate" : "Invalid certificate";
  return (
    <div className={`ssl-verdict ssl-t-${tone}`}>
      <span className="ssl-ic" aria-hidden="true"><Icon size={22} strokeWidth={2.2} /></span>
      <div className="ssl-vb">
        <h2>{title}</h2>
        <p className="ssl-host" title={host}>{host}</p>
        <p className="ssl-msg"><b>{TLS_TITLE[tls.status] || TLS_TITLE.error}</b>{tls.message ? ` · ${tls.message}` : ""}</p>
      </div>
    </div>
  );
}

function SanList({ sans }) {
  const [all, setAll] = useState(false);
  const shown = all ? sans : sans.slice(0, SAN_PREVIEW);
  const extra = sans.length - SAN_PREVIEW;
  return (
    <div className="ssl-sec">
      <h3 className="ssl-h3">Domain coverage <span className="ssl-count">{sans.length}</span></h3>
      <ul className="ssl-sans">
        {shown.map((s) => <li key={s} title={s}>{s}</li>)}
        {extra > 0 && (
          <li className="ssl-more"><button type="button" className="pill" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `+${extra} more`}
          </button></li>
        )}
      </ul>
    </div>
  );
}

function CtCertificate({ ct, tls }) {
  if (ct.status === "unavailable") {
    return <Notice tone="w" title="Certificate details unavailable">The Certificate Transparency log service (crt.sh) didn't answer. The connection result above is still accurate — try again in a minute for details.</Notice>;
  }
  if (ct.status !== "found" || !ct.certificate) {
    return <Notice tone="w" title="No certificate found in CT logs">No currently valid certificate naming this host was found in public Certificate Transparency logs.</Notice>;
  }
  const c = ct.certificate;
  const days = daysUntil(parseDate(c.notAfter));
  const sev = expirySeverity(days);
  const { tone, Icon } = SEV[sev.level] || SEV.unknown;
  const sans = c.sans || [];
  return (
    <>
      <div className="metrics ssl-metrics">
        <div className="metric">
          <div className="k">Days remaining</div>
          <div className={`v ${tone ? `${tone}-tx` : ""}`}>
            {days == null ? "—" : days < 0 ? <>{-days}<small>day{-days === 1 ? "" : "s"} ago</small></> : <>{days}<small>day{days === 1 ? "" : "s"}</small></>}
          </div>
          <div className={`ssl-sev ${tone ? `${tone}-tx` : ""}`}><Icon size={13} aria-hidden="true" strokeWidth={2.4} />{sev.label}</div>
        </div>
        <div className="metric">
          <div className="k">Expires</div>
          <div className="v ssl-v-sm"><CalendarClock size={15} aria-hidden="true" />{fmtDate(c.notAfter)}</div>
        </div>
        <div className="metric ssl-wide">
          <div className="k">Issuer</div>
          <div className="v ssl-v-sm ssl-issuer" title={c.issuer || undefined}>{c.issuer || "—"}</div>
        </div>
      </div>

      {!tls.ok && tls.status === "expired" && days != null && days >= 0 && (
        <Notice tone="w" title="Renewed but not deployed?" className="ssl-gap">A newer valid certificate exists in the logs, but the server is still presenting an expired one.</Notice>
      )}

      {sans.length > 0 && <SanList sans={sans} />}

      <details className="more">
        <summary>Technical details</summary>
        {c.commonName && <div className="kv"><span className="k">Common name</span><span className="v">{c.commonName}</span></div>}
        <div className="kv"><span className="k">Valid from</span><span className="v">{fmtDate(c.notBefore)}</span></div>
        <div className="kv"><span className="k">Valid until</span><span className="v">{fmtDate(c.notAfter)}</span></div>
        <div className="kv"><span className="k">Connection status</span><span className="v">{tls.status}</span></div>
        {c.serial && <div className="kv"><span className="k">Serial</span><span className="v ssl-serial">{c.serial}</span></div>}
        {c.crtshId != null && <div className="kv"><span className="k">Log entry</span>
          <span className="v"><a className="ssl-link" href={`https://crt.sh/?id=${encodeURIComponent(c.crtshId)}`} target="_blank" rel="noopener noreferrer">
            crt.sh #{c.crtshId}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></span></div>}
        <p className="hint ssl-src">
          The certificate details come from public Certificate Transparency logs: the most recently issued valid certificate
          for this name. That is usually, but not always, the one the server presents — CDNs and load balancers can serve
          different ones. The connection result above is from a live handshake.
        </p>
      </details>
    </>
  );
}

export default function SslTool({ arg }) {
  const [domain, setDomain] = useState(() => (typeof arg === "string" ? arg : ""));
  const [inputErr, setInputErr] = useState("");
  const [state, setState] = useState({ kind: "idle" });   // idle | loading | error | done
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const check = async (raw = domain) => {
    const n = normalizeDomain(raw);
    if (!n.ok) { setInputErr(n.message); return; }
    setInputErr("");
    setDomain(n.host);
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; c.abort(); }, TIMEOUT_MS);
    setState({ kind: "loading", host: n.host });
    try {
      const data = await fetchSslCheck(n.host, c.signal);
      if (ctrl.current === c) setState({ kind: "done", data });
    } catch (e) {
      if (ctrl.current !== c || (e?.name === "AbortError" && !timedOut)) return;   // superseded or unmounted
      setState({ kind: "error", host: n.host, message: timedOut
        ? "The check took too long — the server or the certificate log may be slow. Try again."
        : e?.message || "Unable to check right now. Please try again." });
    } finally {
      clearTimeout(timer);
    }
  };

  /* deep link: /tool/ssl/<domain> checks that domain straight away */
  useEffect(() => {
    if (typeof arg !== "string" || !arg.trim()) return;
    check(arg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arg]);

  const loading = state.kind === "loading";
  const d = state.data;
  const offline = state.kind === "error" && typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="ssl">
      <form className="panel ssl-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!loading) check(); }}>
        <div className="field">
          <label htmlFor="ssl-domain">Domain name</label>
          <div className="inrow stack">
            <input id="ssl-domain" className="mono" type="text" inputMode="url" enterKeyHint="go" autoComplete="off" autoCapitalize="off" spellCheck={false}
              value={domain} onChange={(e) => { setDomain(e.target.value); if (inputErr) setInputErr(""); }}
              placeholder="example.com" aria-invalid={!!inputErr} aria-describedby={inputErr ? "ssl-domain-err" : "ssl-domain-hint"} />
            <button className="btn pri auto" type="submit" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {loading ? "Checking…" : "Check certificate"}
            </button>
          </div>
          {inputErr
            ? <div id="ssl-domain-err" role="alert" className="err-tx">{inputErr}</div>
            : <div id="ssl-domain-hint" className="hint">Paste a domain or a full URL. We connect on port 443; IP addresses and internal hosts aren't checked.</div>}
        </div>
      </form>

      <div className="ssl-slot" aria-live="polite" aria-busy={loading}>
        {state.kind === "idle" && (
          <EmptyState icon={Lock} title="No certificate checked yet">
            We connect to the site over TLS to confirm its certificate is trusted, valid and issued for that name, then show
            the latest certificate for it from public Certificate Transparency logs — issuer, validity dates and days to expiry.
          </EmptyState>
        )}
        {loading && (
          <div className="ssl-card ssl-loading">
            <p className="ssl-scan-tx"><Loader2 size={14} className="spin" aria-hidden="true" />Checking <span className="ssl-mono">{state.host}</span>…</p>
            <div aria-hidden="true">
              <div className="skel ssl-sk-h" />
              <div className="skel ssl-sk-p" />
              <div className="ssl-sk-m">{[0, 1, 2].map((i) => <div key={i} className="skel" />)}</div>
            </div>
          </div>
        )}
        {state.kind === "error" && (
          <Notice tone={offline ? "off" : "w"} role="alert" title={offline ? "You're offline" : <>Couldn't check <span className="ssl-mono">{state.host}</span></>}
            actions={<button className="btn gh sm" type="button" onClick={() => check()}><RotateCcw size={14} aria-hidden="true" />Try again</button>}>
            {state.message}
          </Notice>
        )}
        {state.kind === "done" && d && (
          <section className="ssl-card" aria-label="Certificate result">
            <Verdict tls={d.tls} host={d.host} />
            <CtCertificate ct={d.ct || { status: "unavailable" }} tls={d.tls} />
          </section>
        )}
      </div>
    </div>
  );
}
