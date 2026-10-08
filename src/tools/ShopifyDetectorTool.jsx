import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Zap, CheckCircle, XCircle, AlertCircle, ShieldAlert, Copy, ExternalLink, CheckCheck, Loader2, Check, ClipboardList, Link2 } from 'lucide-react';
import { reportFromResponse } from '../../shared/shopifyCore/detect.mjs';
import { detailTiles, retryAfterSec, verdictLabel } from '../lib/shopifyView.js';
import { addRecent, loadRecent, saveRecent, hostOf as recentHost } from '../lib/recentChecks.js';
import { useNow, readParams, writeParams } from '../hooks/index.js';
import RecentChecks from '../components/RecentChecks.jsx';
import './css/shopify.css';

const TIMEOUT_MS = 30000;
const EXAMPLES = ['allbirds.com', 'gymshark.com', 'wikipedia.org'];
const RECENT_KEY = 'toolDeck.shopifyRecent';
/* 400s that are about what was typed (vs. the service failing) — only these mark the input invalid */
const INPUT_CODES = new Set(['missing_url', 'invalid_url', 'unresolvable_host', 'blocked_host']);

/* verdict → what we show. "blocked" = the site refused to serve us the page and nothing else proved it either way */
const VIEW = {
  yes: { Icon: CheckCircle, title: 'Shopify store detected' },
  uncertain: { Icon: AlertCircle, title: 'Possibly Shopify' },
  blocked: { Icon: ShieldAlert, title: "Couldn't see the page" },
  no: { Icon: XCircle, title: 'Not a Shopify store' },
};

const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u; } };
const shareLink = (input) => `${window.location.origin}/tool/shopifydetector?url=${encodeURIComponent(input)}`;

/* After a check the address bar becomes the shareable ?url= link (a /tool/shopifydetector/<host> deep link is folded into it). */
function syncAddress(input) {
  try {
    const m = window.location.pathname.match(/^(\/tool\/shopifydetector)\/.+$/);
    if (m) window.history.replaceState(null, '', m[1] + window.location.search + window.location.hash);
    writeParams({ url: input });
  } catch { /* history unavailable */ }
}

/* Rate-limit countdown — a leaf so only it re-renders each second. The visible count is
   hidden from screen readers (a ticking alert would re-announce); they get the fixed wait once. */
function RetryIn({ until, sec }) {
  const now = useNow(1000);
  const left = Math.ceil((until - now.getTime()) / 1000);
  return (
    <>
      <span aria-hidden="true">{left > 0 ? `Too many checks — try again in ${left}s.` : 'You can check again now.'}</span>
      <span className="sr-only">Too many checks — try again in {sec} seconds.</span>
    </>
  );
}

/* Confidence ring: the verdict's accent fills the share of the circle the server is sure of. */
function Ring({ pct, Icon }) {
  const v = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="sd-ring" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label="Detection confidence">
      <svg className="sd-ring-svg" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="27" className="sd-ring-track" />
        {v > 0 && <circle cx="32" cy="32" r="27" className="sd-ring-fill" pathLength="100" strokeDasharray={`${v} 100`} />}
      </svg>
      {v > 0 ? <b>{v}<small>%</small></b> : <Icon size={22} aria-hidden="true" />}
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
  return { kind, verdict, blocked, pct, details, signals };
}

const linkValue = (arg) => (typeof arg === 'string' && arg.trim()) || readParams().get('url')?.trim() || '';

export default function ShopifyDetectorTool({ notify, arg }) {
  const [url, setUrl] = useState(() => linkValue(arg));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);   // { message, input? } | { retryUntil, retrySec }
  const [copied, setCopied] = useState(null);   // 'report' | 'link' | 'url'
  const [recent, setRecent] = useState(() => loadRecent(RECENT_KEY));
  const ctrl = useRef(null);
  const copyTimer = useRef(0);

  useEffect(() => () => { ctrl.current?.abort(); clearTimeout(copyTimer.current); }, []);

  const checkUrl = useCallback(async (urlToCheck) => {
    const trimmed = urlToCheck.trim();
    if (!trimmed) {
      setError({ message: 'Please enter a website URL to check.', input: true });
      return;
    }
    if (!recentHost(trimmed)) {
      setError({ message: "That doesn't look like a website address — try something like example-store.com.", input: true });
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
      if (response.status === 429) {
        const sec = retryAfterSec(data, response.headers.get('Retry-After'));
        setError(sec ? { retryUntil: Date.now() + sec * 1000, retrySec: sec } : { message: data?.error?.message || 'Too many checks — try again in a minute.' });
        return;
      }
      if (!response.ok || !data) {
        /* a bare 404 comes from the Supabase gateway (function not deployed), not from our function */
        if (response.status === 404 && !data?.error) throw new Error("Couldn't reach the Shopify check service right now. Please try again in a few minutes.");
        if (response.status === 400 && INPUT_CODES.has(data?.error?.code)) {
          setError({ message: data.error.message, input: true });
          return;
        }
        throw new Error(data?.error?.message || 'Failed to check URL. Please try again.');
      }
      const view = describe(data);
      setResult({
        url: data.final_url || data.input_url,
        input: trimmed,
        ...view,
        shop_domain: data.shop_domain,
        elapsed_ms: data.elapsed_ms,
        tiles: detailTiles(data),
        report: reportFromResponse(data),
      });
      syncAddress(trimmed);
      const host = recentHost(trimmed);
      if (host) setRecent((l) => { const n = addRecent(l, { host, label: verdictLabel(view.kind) }); saveRecent(RECENT_KEY, n); return n; });
    } catch (err) {
      if (ctrl.current !== c || (err?.name === 'AbortError' && !timedOut)) return;   // superseded or unmounted
      setError({ message: timedOut
        ? 'The check took too long. The site may be slow or blocking automated requests — try again.'
        : err?.name === 'TypeError' ? "Couldn't reach the Shopify check service. Check your connection and try again."
        : err instanceof Error ? err.message : 'Something went wrong while checking that site.' });
    } finally {
      clearTimeout(timer);
      if (ctrl.current === c) setLoading(false);
    }
  }, []);

  /* deep link: /tool/shopifydetector/<url> or ?url=<url> checks straight away */
  useEffect(() => {
    const v = linkValue(arg);
    if (!v) return;
    setUrl(v);
    checkUrl(v);
  }, [arg, checkUrl]);

  const handleSubmit = (e) => {
    e.preventDefault();
    checkUrl(url);
  };

  const copy = (what) => {
    if (!result) return;
    const text = what === 'report' ? result.report : what === 'link' ? shareLink(result.input) : result.url;
    const done = () => {
      setCopied(what);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
      if (what === 'report') notify?.('Report copied — paste it into your notes or CRM.');
    };
    const failed = () => notify?.("Couldn't copy — your browser blocked clipboard access.");
    try {
      if (!navigator.clipboard?.writeText) return failed();
      navigator.clipboard.writeText(text).then(done, failed);
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
  const inputErr = !!error?.input;
  const showHint = !result && !loading && !error;

  return (
    <div className="panel sd">
      <form onSubmit={handleSubmit} noValidate className="sd-form">
        <div className="field">
          <label htmlFor="shopify-url">Website URL</label>
          <input
            id="shopify-url"
            type="text"
            inputMode="url"
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            onChange={(e) => { setUrl(e.target.value); if (inputErr) setError(null); }}
            placeholder="e.g. example-store.com"
            disabled={loading}
            aria-invalid={inputErr}
            aria-describedby={inputErr ? 'shopify-error' : showHint ? 'shopify-hint' : undefined}
          />
        </div>
        <button type="submit" className="btn pri" disabled={loading}>
          {loading ? <Loader2 size={16} className="sd-spin" aria-hidden="true" /> : <Zap size={16} aria-hidden="true" />}
          {loading ? 'Checking…' : 'Check store'}
        </button>
      </form>
      {showHint && (
        <p id="shopify-hint" className="sd-try">Try
          {EXAMPLES.map((ex) => <button key={ex} type="button" className="pill" onClick={() => tryExample(ex)}>{ex}</button>)}
        </p>
      )}

      {error && (
        <div id="shopify-error" role="alert" className="note e sd-gap">
          {error.retryUntil ? <RetryIn until={error.retryUntil} sec={error.retrySec} /> : error.message}
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <div className="sd-result sd-loading" aria-hidden="true">
            <div className="sd-head"><div className="skel sd-skel-ring" /><div style={{ flex: 1 }}><div className="skel" style={{ height: 20, width: '55%' }} /><div className="skel" style={{ height: 12, width: '80%', marginTop: 10 }} /></div></div>
            <div className="sd-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 54 }} />)}</div>
          </div>
        )}
        {result && !loading && (
          <section className={`sd-result sd-${result.kind}`} aria-label="Detection result">
            <div className="sd-head">
              <Ring pct={result.kind === 'blocked' ? 0 : result.pct} Icon={view.Icon} />
              <div className="sd-verdict">
                <h2><view.Icon size={18} aria-hidden="true" />{view.title}</h2>
                <p>{result.details}</p>
              </div>
              <div className="sd-actions">
                <button type="button" className="pill" onClick={() => copy('report')} title="Copy a plain-text summary for notes or a CRM">
                  {copied === 'report' ? <CheckCheck size={14} aria-hidden="true" /> : <ClipboardList size={14} aria-hidden="true" />}
                  {copied === 'report' ? 'Copied' : 'Copy report'}
                </button>
                <button type="button" className="pill" onClick={() => copy('link')} title="Copy a link that re-runs this check">
                  {copied === 'link' ? <CheckCheck size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                  {copied === 'link' ? 'Copied' : 'Share link'}
                </button>
                <button type="button" className="pill" onClick={handleVisit} aria-label={`Visit ${hostOf(result.url)} in a new tab`}>
                  <ExternalLink size={14} aria-hidden="true" />Visit
                </button>
              </div>
            </div>

            <dl className="sd-stats">
              <div className="wide sd-site"><dt>Website</dt><dd title={result.url}>{hostOf(result.url)}</dd>
                <button type="button" className="sd-copyurl" onClick={() => copy('url')} aria-label={copied === 'url' ? 'Website URL copied' : 'Copy website URL'} title="Copy website URL">
                  {copied === 'url' ? <CheckCheck size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                </button>
              </div>
              <div className="wide"><dt>Store domain</dt><dd title={result.shop_domain || undefined}>{result.shop_domain || '—'}</dd></div>
              <div><dt>Signals found</dt><dd>{result.signals.length}</dd></div>
              <div><dt>Checked in</dt><dd>{result.elapsed_ms != null ? `${(result.elapsed_ms / 1000).toFixed(result.elapsed_ms < 10000 ? 2 : 1)} s` : '—'}</dd></div>
            </dl>

            {result.tiles.length > 0 && (
              <dl className="sd-stats sd-more" aria-label="Store details">
                {result.tiles.map((t) => <div key={t.k}><dt>{t.k}</dt><dd title={t.title || t.v}>{t.v}</dd></div>)}
              </dl>
            )}

            {result.signals.length > 0 && (
              <div className="sd-signals">
                <h3>What we found <span>{result.signals.length}</span></h3>
                <ul>
                  {result.signals.map((signal, i) => (
                    <li key={i} style={{ '--i': i }}><Check size={14} aria-hidden="true" />{signal}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      {!loading && (
        <RecentChecks items={recent} onPick={(h) => { setUrl(h); checkUrl(h); }} onClear={() => { setRecent([]); saveRecent(RECENT_KEY, []); }} />
      )}
    </div>
  );
}
