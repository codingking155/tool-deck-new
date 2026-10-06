import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Zap, Globe, CheckCircle, XCircle, AlertCircle, ChevronDown, Copy, ExternalLink, CheckCheck, Loader2 } from 'lucide-react';

const TIMEOUT_MS = 30000;
const soft = (c) => `color-mix(in srgb, ${c} 12%, transparent)`;

/* verdict → what we show. "blocked" = the site refused to serve us the page and nothing else proved it either way */
const VIEW = {
  yes: { color: 'var(--good)', Icon: CheckCircle, title: 'Shopify store detected' },
  uncertain: { color: 'var(--warn)', Icon: AlertCircle, title: 'Possibly Shopify' },
  blocked: { color: 'var(--warn)', Icon: AlertCircle, title: "Couldn't see the page" },
  no: { color: 'var(--tx2)', Icon: XCircle, title: 'Not a Shopify store' },
};

function describe(data) {
  const pct = data.confidence_pct ?? Math.round((data.confidence ?? 0) * 100);
  const verdict = data.verdict || (data.is_shopify ? 'yes' : pct >= 25 ? 'uncertain' : 'no');
  const blocked = !!data.page_blocked;
  const signals = data.detected_signals || [];
  let kind = verdict, details = '';
  if (verdict === 'yes') {
    details = [data.shop_domain && `Shop domain: ${data.shop_domain}`, signals.length && `${signals.length} Shopify signal${signals.length === 1 ? '' : 's'} detected`].filter(Boolean).join(' • ');
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

export default function ShopifyDetectorTool({ notify }) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);
  const ctrl = useRef(null);
  const copyTimer = useRef(0);

  useEffect(() => () => { ctrl.current?.abort(); clearTimeout(copyTimer.current); }, []);

  const checkUrl = useCallback(async (urlToCheck) => {
    const trimmed = urlToCheck.trim();
    if (!trimmed) {
      setError('Please enter a website URL to check.');
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
      setShowTechnical(false);

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
      setError(timedOut
        ? 'The check took too long. The site may be slow or blocking automated requests — try again.'
        : err?.name === 'TypeError' ? "Couldn't reach the Shopify check service. Check your connection and try again."
        : err instanceof Error ? err.message : 'Something went wrong while checking that site.');
    } finally {
      clearTimeout(timer);
      if (ctrl.current === c) setLoading(false);
    }
  }, []);

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
  const actionBtn = { display: 'flex', alignItems: 'center', gap: '4px' };

  return (
    <div className="panel" style={{ padding: 20 }}>
      {/* Form */}
      <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <label htmlFor="shopify-url">Website URL</label>
            <input
              id="shopify-url"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. example-store.com"
              disabled={loading}
              aria-invalid={!!error}
              aria-describedby={error ? 'shopify-error' : undefined}
            />
          </div>
          <button type="submit" className="btn pri" disabled={loading} style={{ width: 'auto' }}>
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" /> : <Zap size={16} aria-hidden="true" />}
            {loading ? 'Checking...' : 'Check Now'}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div id="shopify-error" role="alert" className="note e" style={{ color: 'var(--tx)', margin: '16px 0 0' }}>
          {error}
        </div>
      )}

      {/* Result */}
      <div aria-live="polite">
      {result && (
        <div style={{
          padding: '20px',
          backgroundColor: 'var(--panel2)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          marginTop: '16px',
          color: 'var(--tx)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ padding: '12px', backgroundColor: soft(view.color), borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <view.Icon className="w-6 h-6" style={{ color: view.color }} aria-hidden="true" />
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: view.color }}>{view.title}</h2>
                {result.pct > 0 && result.kind !== 'blocked' && (
                  <p style={{ fontSize: '12px', color: 'var(--tx3)', marginTop: '4px' }}>
                    Confidence: {Math.round(result.pct)}%
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="pill" onClick={handleCopy} style={actionBtn}>
                {copied ? <CheckCheck size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="pill" onClick={handleVisit} style={actionBtn}>
                <ExternalLink size={14} aria-hidden="true" />
                Visit
              </button>
            </div>
          </div>

          {/* URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'var(--bg)', borderRadius: '6px', marginBottom: '16px', fontSize: '12px', fontFamily: 'var(--mono)' }}>
            <Globe size={14} style={{ color: 'var(--tx3)' }} aria-hidden="true" />
            <span style={{ wordBreak: 'break-all' }}>{result.url}</span>
            {result.shop_domain && <span style={{ color: 'var(--good)', fontWeight: 600, marginLeft: 'auto' }}>{result.shop_domain}</span>}
          </div>

          {/* Message */}
          <div style={{ padding: '12px', backgroundColor: soft(view.color), border: `1px solid ${view.color}`, borderRadius: '6px', marginBottom: '16px' }}>
            <p style={{ fontWeight: 600, color: 'var(--tx)' }}>{view.title}</p>
            {result.details && <p style={{ fontSize: '12px', color: 'var(--tx2)', marginTop: '4px' }}>{result.details}</p>}
          </div>

          {/* Confidence Meter */}
          {result.verdict === 'yes' && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ fontWeight: 500 }}>Detection Confidence</span>
                <span style={{ fontWeight: 600, color: 'var(--good)' }}>{Math.round(result.pct)}%</span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--panel2)', borderRadius: '4px', overflow: 'hidden' }}
                role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(result.pct)} aria-label="Detection confidence">
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, result.pct))}%`,
                    background: result.pct > 70 ? 'var(--good)' : result.pct > 30 ? 'var(--warn)' : 'var(--bad)',
                    transition: 'width 0.8s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Technical Details */}
          {result.signals.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowTechnical(!showTechnical)}
                aria-expanded={showTechnical}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--tx)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                <span>Technical Signals</span>
                <ChevronDown size={16} aria-hidden="true" style={{ transform: showTechnical ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
              </button>
              {showTechnical && (
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg)', borderRadius: '6px', fontSize: '12px' }}>
                  {result.signals.map((signal, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: i < result.signals.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      • {signal}
                    </div>
                  ))}
                  {result.elapsed_ms != null && <p style={{ marginTop: '8px', color: 'var(--tx3)' }}>Detection took {result.elapsed_ms}ms</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
