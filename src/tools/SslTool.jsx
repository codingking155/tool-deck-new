import { useState, useRef, useEffect } from "react";
import { normalizeDomain, parseDate, daysUntil, expirySeverity } from "../../shared/sslCore/index.mjs";

/* Talks to our `ssl-check` edge function: a real TLS handshake to host:443 plus the
   latest valid certificate for the name from Certificate Transparency (crt.sh). */

const TIMEOUT_MS = 25_000;

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
const SEV_COLOR = { expired: "var(--bad)", critical: "var(--bad)", warning: "var(--warn)", ok: "var(--good)", unknown: "var(--tx2)" };

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

function TlsResult({ tls }) {
  const color = tls.ok ? "var(--good)" : "var(--bad)";
  return (
    <div className="note" style={{ borderColor: color }}>
      <b style={{ color }}>{tls.ok ? "✓" : "✗"} {TLS_TITLE[tls.status] || TLS_TITLE.error} · </b>{tls.message}
    </div>
  );
}

function CtCertificate({ ct, tls }) {
  if (ct.status === "unavailable") {
    return <div className="note w"><b>Certificate details unavailable · </b>the Certificate Transparency log service (crt.sh) didn't answer. The connection result above is still accurate — try again in a minute for details.</div>;
  }
  if (ct.status !== "found" || !ct.certificate) {
    return <div className="note w"><b>No certificate found in CT logs · </b>no currently valid certificate naming this host was found in public Certificate Transparency logs.</div>;
  }
  const c = ct.certificate;
  const days = daysUntil(parseDate(c.notAfter));
  const sev = expirySeverity(days);
  const color = SEV_COLOR[sev.level];
  const sans = c.sans || [];
  return (
    <>
      <div className="kv"><span className="k">Issuer</span><span className="v">{c.issuer || "—"}</span></div>
      {c.commonName && <div className="kv"><span className="k">Common name</span><span className="v">{c.commonName}</span></div>}
      <div className="kv"><span className="k">Valid from</span><span className="v">{fmtDate(c.notBefore)}</span></div>
      <div className="kv"><span className="k">Valid until</span><span className="v" style={{ color }}>{fmtDate(c.notAfter)}</span></div>
      <div className="kv"><span className="k">Days left</span>
        <span className="v" style={{ color, fontWeight: 600 }}>
          {days == null ? "—" : days < 0 ? `Expired ${-days} day${-days === 1 ? "" : "s"} ago` : `${days} day${days === 1 ? "" : "s"}`} · {sev.label}
        </span></div>
      {sans.length > 0 && <div className="kv"><span className="k">Names (SANs)</span>
        <span className="v" style={{ fontSize: 11.5 }}>{sans.slice(0, 8).join(", ")}{sans.length > 8 ? ` +${sans.length - 8} more` : ""}</span></div>}
      {c.serial && <div className="kv"><span className="k">Serial</span><span className="v" style={{ fontSize: 11 }}>{c.serial}</span></div>}
      {c.crtshId != null && <div className="kv"><span className="k">Log entry</span>
        <span className="v"><a href={`https://crt.sh/?id=${encodeURIComponent(c.crtshId)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pri2)" }}>crt.sh #{c.crtshId} ↗</a></span></div>}
      {!tls.ok && tls.status === "expired" && days != null && days >= 0 && (
        <div className="note w" style={{ marginTop: 12 }}><b>Renewed but not deployed? · </b>a newer valid certificate exists in the logs, but the server is still presenting an expired one.</div>
      )}
    </>
  );
}

export default function SslTool() {
  const [domain, setDomain] = useState("");
  const [inputErr, setInputErr] = useState("");
  const [state, setState] = useState({ kind: "idle" });   // idle | loading | error | done
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const check = async () => {
    const n = normalizeDomain(domain);
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

  const loading = state.kind === "loading";
  const d = state.data;

  return (
    <div className="grid2">
      <div className="panel">
        <div className="ph"><h2>Domain</h2><p>Check the certificate a site serves on port 443</p></div>
        <div className="pb">
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (!loading) check(); }}>
            <div className="field">
              <label htmlFor="ssl-domain">Domain name</label>
              <input id="ssl-domain" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
                value={domain} onChange={(e) => { setDomain(e.target.value); if (inputErr) setInputErr(""); }}
                placeholder="example.com" aria-invalid={!!inputErr} aria-describedby={inputErr ? "ssl-domain-err" : "ssl-domain-hint"} />
              {inputErr
                ? <div id="ssl-domain-err" role="alert" className="hint" style={{ color: "var(--bad)", marginTop: 6 }}>{inputErr}</div>
                : <div id="ssl-domain-hint" className="hint" style={{ marginTop: 6 }}>Paste a domain or a full URL. IP addresses and internal hosts aren't checked.</div>}
            </div>
            <button className="btn pri" type="submit" disabled={loading}>{loading ? "Checking…" : "Check certificate"}</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="ph"><h2>Certificate</h2><p>{d ? d.host : loading ? `Checking ${state.host}…` : "Check a domain to see details"}</p></div>
        <div className="pb" aria-live="polite" aria-busy={loading}>
          {state.kind === "idle" && (
            <div className="empty">
              <p>We connect to the site over TLS to confirm its certificate is trusted, valid and issued for that name, then show
                the latest certificate for it from public Certificate Transparency logs — issuer, validity dates and days to expiry.</p>
            </div>
          )}
          {loading && <><div className="skel" style={{ height: 44, marginBottom: 10 }} /><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18 }} /></>}
          {state.kind === "error" && (
            <div role="alert">
              <div className="note w"><b>Couldn't check {state.host} · </b>{state.message}</div>
              <button className="btn gh" type="button" onClick={check}>Try again</button>
            </div>
          )}
          {state.kind === "done" && d && (
            <>
              <TlsResult tls={d.tls} />
              <h3 style={{ margin: "16px 0 4px", fontSize: 13 }}>Latest certificate in Certificate Transparency logs</h3>
              <CtCertificate ct={d.ct || { status: "unavailable" }} tls={d.tls} />
              <div className="hint" style={{ marginTop: 12 }}>
                The certificate details come from public Certificate Transparency logs: the most recently issued valid certificate
                for this name. That is usually, but not always, the one the server presents — CDNs and load balancers can serve
                different ones. The connection result above is from a live handshake.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
