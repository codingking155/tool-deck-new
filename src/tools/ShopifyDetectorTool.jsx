import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, CircleCheck, CircleX, CircleHelp, ShieldAlert, Copy, ExternalLink, CheckCheck, Loader2, Check, Store, RotateCcw } from 'lucide-react';
import { Notice, EmptyState } from '../components/ui.jsx';
import "./css/shopify.css";

const TIMEOUT_MS = 30000;
const EXAMPLES = ['allbirds.com', 'gymshark.com', 'wikipedia.org'];

/* verdict → what we show. "blocked" = the site refused to serve us the page and nothing else proved it either way */
const VIEW = {
  yes: { Icon: CircleCheck, title: 'Shopify store detected', tone: 'ok' },
  uncertain: { Icon: CircleHelp, title: 'Unable to determine confidently', tone: 'warn' },
  blocked: { Icon: ShieldAlert, title: 'Unable to determine — the site blocked our check', tone: 'warn' },
  no: { Icon: CircleX, title: 'Not Shopify', tone: 'neutral' },
};

const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u; } };

/* Confidence meter: a labelled bar; the number is always printed next to it. */
function ConfidenceMeter({ pct, measured }) {
  const v = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="sd-meter">
      <div className="sd-meter-top">
        <span className="sd-meter-k">Detection confidence</span>
        <b className="sd-meter-v">{measured ? <>{v}<small>%</small></> : 'Not measured'}</b>
      </div>
      <div className="sd-meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}
        aria-valuetext={measured ? `${v}%` : 'Not measured'} aria-label="Detection confidence">
        <i style={{ '--v': `${measured ? v : 0}%` }} />
      </div>
    </div>
  );
}

function describe(data) {
  const pct = data.confidence_pct ?? Math.round((data.confidence ?? 0) * 100);
  const verdict = data.verdict || (data.is_shopify ? 'yes' : pct >= 25 ? 'uncertain' : 'no');
  const blocked = !!data.page_blocked;
  const signals = data.detected_signals || [];
  let kind = verdict, details = '';
  if (verdict === 'yes') {
    details = pct >= 90 ? 'This website runs on Shopify — several independent signals agree.' : 'This website runs on Shopify.';
  } else if (verdict === 'uncertain' && blocked && pct < 25) {
    kind = 'blocked';
    details = "The site blocked our check (bot protection or rate limiting) and nothing else confirmed the platform. Try again later, or open it in a browser.";
  } else if (verdict === 'uncertain') {
    details = 'Some Shopify-like signals were found, but not enough to confirm.';
  } else {
    details = blocked
      ? "The page itself was blocked, so this is based on limited evidence (headers and storefront endpoints)."
      : 'This website does not appear to be powered by Shopify.';
  }
  if (verdict !== 'yes' && data.platform) details += ` Detected platform: ${data.platform}.`;
  return { kind, verdict, blocked, pct, details, signals, platform: data.platform || null };
}

/* error message → calm headline; the message itself stays as the body */
function errorTitle(msg, timedOut) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline";
  if (timedOut) return 'The check timed out';
  if (/isn't configured/i.test(msg)) return 'Not available on this deployment';
  if (/couldn't reach/i.test(msg)) return "Couldn't reach the check service";
  if (/429|rate.?limit|too many/i.test(msg)) return 'Too many checks';
  return "Couldn't check this site";
}

const fmtElapsed = (ms) => (ms != null ? `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s` : '—');

export default function ShopifyDetectorTool({ notify, arg }) {
  const [url, setUrl] = useState(() => (typeof arg === 'string' ? arg : ''));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);   // { title, msg, input?: true }
  const [copied, setCopied] = useState(false);
  const ctrl = useRef(null);
  const copyTimer = useRef(0);

  useEffect(() => () => { ctrl.current?.abort(); clearTimeout(copyTimer.current); }, []);

  const checkUrl = useCallback(async (urlToCheck) => {
    const trimmed = urlToCheck.trim();
    if (!trimmed) {
      setError({ input: true, msg: 'Please enter a website URL to check.' });
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; c.abort(); }, TIMEOUT_MS);

    try {
      setLoading(true);
      setError(null);
      setResult(null);

      // Our own shopify-check edge function (same response shape as before)
      const base = import.meta.env.VITE_SUPABASE_URL;
      if (!base) throw new Error("The Shopify check isn't configured on this deployment.");
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(
        `${base}/functions/v1/shopify-check?url=${encodeURIComponent(trimmed)}`,
        {
          signal: c.signal,
          headers: { Accept: 'application/json', ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
        }
      );

      const data = await response.json().catch(() => null);
      if (c.signal.aborted && !timedOut) return;
      if (!response.ok || !data) {
        /* a bare 404 comes from the Supabase gateway (function not deployed), not from our function */
        if (response.status === 404 && !data?.error) throw new Error("Couldn't reach the Shopify check service right now. Please try again in a few minutes.");
        throw new Error(data?.error?.message || 'Failed to check URL. Please try again.');
      }
      setResult({
        url: data.final_url || data.input_url,
        ...describe(data),
        shop_domain: data.shop_domain,
        elapsed_ms: data.elapsed_ms,
      });
    } catch (err) {
      if (ctrl.current !== c || (err?.name === 'AbortError' && !timedOut)) return;   // superseded or unmounted
      const msg = timedOut
        ? 'The check took too long. The site may be slow or blocking automated requests — try again.'
        : err?.name === 'TypeError' ? "Couldn't reach the Shopify check service. Check your connection and try again."
        : err instanceof Error ? err.message : 'Something went wrong while checking that site.';
      setError({ title: errorTitle(msg, timedOut), msg });
    } finally {
      clearTimeout(timer);
      if (ctrl.current === c) setLoading(false);
    }
  }, []);

  /* deep link: /tool/shopifydetector/<domain> checks that domain straight away */
  useEffect(() => {
    if (typeof arg !== 'string' || !arg.trim()) return;
    setUrl(arg);
    checkUrl(arg);
  }, [arg, checkUrl]);

  const handleSubmit = (e) => {
    e.preventDefault();
    checkUrl(url);
  };

  const handleCopy = () => {
    if (!result) return;
    const done = () => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    };
    const failed = () => notify?.("Couldn't copy — select the URL and copy it manually.");
    try {
      if (!navigator.clipboard?.writeText) return failed();
      navigator.clipboard.writeText(result.url).then(done, failed);
    } catch { failed(); }
  };

  const handleVisit = () => {
    if (result) {
      const targetUrl = /^https?:\/\//i.test(result.url) ? result.url : `https://${result.url}`;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const view = result ? VIEW[result.kind] || VIEW.no : null;
  const tryExample = (ex) => { setUrl(ex); checkUrl(ex); };
  const inputErr = error?.input;

  return (
    <div className="sd">
      <form onSubmit={handleSubmit} noValidate className="panel sd-form">
        <div className="field">
          <label htmlFor="shopify-url">Website URL</label>
          <div className="inrow stack">
            <input
              id="shopify-url"
              className="mono"
              type="text"
              inputMode="url"
              enterKeyHint="go"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (inputErr) setError(null); }}
              placeholder="example-store.com"
              disabled={loading}
              aria-invalid={!!inputErr}
              aria-describedby={inputErr ? 'shopify-error' : 'shopify-hint'}
            />
            <button type="submit" className="btn pri auto" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {loading ? 'Checking…' : 'Check store'}
            </button>
          </div>
          {inputErr
            ? <div id="shopify-error" role="alert" className="err-tx">{error.msg}</div>
            : <div id="shopify-hint" className="hint">Paste a domain or a full URL — we look at the public storefront only.</div>}
        </div>
        <div className="sd-try">
          <span>Try</span>
          {EXAMPLES.map((ex) => <button key={ex} type="button" className="pill" onClick={() => tryExample(ex)} disabled={loading}>{ex}</button>)}
        </div>
      </form>

      <div className="sd-slot" aria-live="polite" aria-busy={loading}>
        {!result && !loading && !error?.title && (
          <EmptyState icon={Store} title="No store checked yet">
            Enter a domain to see whether it runs on Shopify, how confident the check is, and the evidence behind it.
          </EmptyState>
        )}

        {error?.title && !loading && (
          <Notice tone={/offline/i.test(error.title) ? 'off' : 'w'} title={error.title} role="alert"
            actions={<button type="button" className="btn gh sm" onClick={() => checkUrl(url)}><RotateCcw size={14} aria-hidden="true" />Try again</button>}>
            {error.msg}
          </Notice>
        )}

        {loading && (
          <div className="sd-result sd-loading">
            <p className="sd-scan-tx"><Loader2 size={14} className="spin" aria-hidden="true" />Scanning <span className="sd-mono">{hostOf(url.trim()) || 'site'}</span> for Shopify signals…</p>
            <div className="sd-scan" aria-hidden="true"><i /></div>
            <div aria-hidden="true">
              <div className="skel sd-sk-h" />
              <div className="skel sd-sk-p" />
              <div className="skel sd-sk-bar" />
              <div className="sd-sk-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" />)}</div>
            </div>
          </div>
        )}

        {result && !loading && (
          <section className={`sd-result sd-${result.kind} sd-t-${view.tone}`} aria-label="Detection result">
            <div className="sd-head">
              <span className="sd-ic" aria-hidden="true"><view.Icon size={22} strokeWidth={2.2} /></span>
              <div className="sd-verdict">
                <h2>{view.title}</h2>
                <p>{result.details}</p>
              </div>
            </div>

            <ConfidenceMeter pct={result.pct} measured={result.kind !== 'blocked'} />

            <dl className="sd-stats">
              <div className="wide"><dt>Website</dt><dd title={result.url}>{hostOf(result.url)}</dd></div>
              <div className="wide"><dt>Store domain</dt><dd title={result.shop_domain || undefined}>{result.shop_domain || '—'}</dd></div>
              <div><dt>Signals found</dt><dd>{result.signals.length}</dd></div>
              <div><dt>Checked in</dt><dd>{fmtElapsed(result.elapsed_ms)}</dd></div>
            </dl>

            <div className="actions sd-actions">
              <button type="button" className="btn gh sm" onClick={handleCopy} aria-live="polite">
                {copied ? <CheckCheck size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy URL'}
              </button>
              <button type="button" className="btn gh sm" onClick={handleVisit} aria-label={`Visit ${hostOf(result.url)} in a new tab`}>
                <ExternalLink size={14} aria-hidden="true" />Visit site
              </button>
            </div>

            {result.signals.length > 0 && (
              <details className="more sd-signals" open={result.kind === 'yes'}>
                <summary>Detection signals <span className="sd-count">{result.signals.length}</span></summary>
                <ul>
                  {result.signals.map((signal, i) => (
                    <li key={i}><Check size={14} aria-hidden="true" />{signal}</li>
                  ))}
                </ul>
              </details>
            )}

            <details className="more sd-tech">
              <summary>Technical evidence</summary>
              <div className="kv"><span className="k">Final URL</span><span className="v">{result.url || '—'}</span></div>
              <div className="kv"><span className="k">Verdict</span><span className="v">{result.verdict} · {Math.round(result.pct)}%</span></div>
              <div className="kv"><span className="k">Page served to checker</span><span className="v">{result.blocked ? 'Blocked (limited evidence)' : 'Yes'}</span></div>
              {result.platform && <div className="kv"><span className="k">Other platform</span><span className="v">{result.platform}</span></div>}
              <div className="kv"><span className="k">Response time</span><span className="v">{fmtElapsed(result.elapsed_ms)}</span></div>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
