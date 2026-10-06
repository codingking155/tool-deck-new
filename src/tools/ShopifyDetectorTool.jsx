import React, { useState, useCallback, useEffect, useRef } from 'react';
import RecentChecks from '../components/RecentChecks.jsx';
import { hostOf, addRecent, loadRecent, saveRecent } from '../lib/recentChecks.js';
import { Zap, Globe, CheckCircle, XCircle, AlertCircle, ChevronDown, Copy, ExternalLink, CheckCheck, Loader2 } from 'lucide-react';

const RECENT_KEY = "toolDeck.shopifyDetectorRecent";

export default function ShopifyDetectorTool() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const [recent, setRecent] = useState(() => loadRecent(RECENT_KEY));
  useEffect(() => {
    const host = result && hostOf(result.url);
    if (!host) return;
    setRecent((r) => { const next = addRecent(r, { host, label: result.isShopify ? "Shopify" : "Not Shopify" }); saveRecent(RECENT_KEY, next); return next; });
  }, [result]);

  const checkUrl = useCallback(async (urlToCheck) => {
    const trimmed = urlToCheck.trim();
    if (!trimmed) {
      setError('Please enter a website URL to check.');
      return;
    }

    if (/\s/.test(trimmed) || !hostOf(trimmed)?.includes('.')) {
      setError('That does not look like a website address. Try something like example-store.com.');
      return;
    }

    // Cancel any in-flight check so a slow older response can't overwrite a newer one.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort('timeout'), 20000);

    try {
      setLoading(true);
      setError(null);
      setResult(null);
      setShowTechnical(false);

      // Call the external Shopify detection API
      const response = await fetch(
        `https://api.shopifyornot.in/check?url=${encodeURIComponent(trimmed)}&source=web`,
        {
          headers: { Accept: 'application/json' },
          mode: 'cors',
          signal: ctrl.signal,
        }
      );

      if (!response.ok) {
        let reason = '';
        try { const j = await response.json(); reason = j.error || j.message || ''; } catch { /* non-JSON error body */ }
        throw new Error(reason || (response.status === 429 ? 'Too many checks right now. Please wait a moment and try again.' : 'Failed to check URL. Please try again.'));
      }

      const data = await response.json();
      if (ctrl.signal.aborted) return;
      const confidence = Math.min(1, Math.max(0, Number(data.confidence) || 0));
      
      let message = '';
      let details = '';
      
      if (data.is_shopify) {
        message = '✅ This is a Shopify store!';
        if (data.shop_domain) {
          details = `Shop domain: ${data.shop_domain}`;
        }
        if (data.detected_signals?.length > 0) {
          details += details ? ' • ' : '';
          details += `${data.detected_signals.length} Shopify signals detected`;
        }
      } else {
        if (confidence > 0.3) {
          message = '⚠️ Possibly not a Shopify store';
          details = 'Some Shopify-like patterns were detected, but not enough to confirm.';
        } else {
          message = '❌ Not a Shopify store';
          details = 'This website does not appear to be powered by Shopify.';
        }
      }

      setResult({
        url: data.final_url || data.input_url || trimmed,
        isShopify: data.is_shopify,
        confidence,
        message,
        details,
        detected_signals: data.detected_signals || [],
        headers_sample: data.headers_sample,
        shop_domain: data.shop_domain,
        elapsed_ms: data.elapsed_ms,
      });
    } catch (err) {
      if (abortRef.current !== ctrl) return; // superseded by a newer check
      if (ctrl.signal.aborted) setError('The check took too long. Please try again.');
      else if (err instanceof TypeError) setError('Could not reach the detection service. Check your connection and try again.');
      else setError(err instanceof Error ? err.message : 'Something went wrong while checking that site.');
    } finally {
      clearTimeout(timer);
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    checkUrl(url);
  };

  const handleCopy = () => {
    if (result) {
      // Only confirm once the write actually succeeded (it can be refused).
      (navigator.clipboard ? navigator.clipboard.writeText(result.url) : Promise.reject(new Error('no clipboard')))
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
        .catch(() => setCopied(false));
    }
  };

  const handleVisit = () => {
    if (result) {
      const targetUrl = /^https?:\/\//i.test(result.url) ? result.url : `https://${result.url}`;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const getStatusIcon = () => {
    if (!result) return null;
    if (result.isShopify) return <CheckCircle size={24} style={{ color: 'var(--good)' }} />;
    if (result.confidence > 0.3) return <AlertCircle size={24} style={{ color: 'var(--warn)' }} />;
    return <XCircle size={24} style={{ color: 'var(--bad)' }} />;
  };

  /* plain values: this project has no Tailwind, so utility class names never applied */
  // Theme tokens, not fixed pastels: a light tint stays readable under
  // var(--tx) text in both the dark (default) and light themes.
  const statusToken = () => (result.isShopify ? '--good' : result.confidence > 0.3 ? '--warn' : '--bad');

  const getStatusColor = () => {
    if (!result) return undefined;
    return `var(${statusToken()})`;
  };

  const getStatusBg = () => {
    if (!result) return undefined;
    return `color-mix(in srgb, var(${statusToken()}) 14%, transparent)`;
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0' }}>
      {/* Form */}
      <form onSubmit={handleSubmit} style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Website URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter website URL (e.g., example-store.com)"
            disabled={loading}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '12px 16px',
              fontSize: '14px',
              border: '1px solid var(--panel2)',
              borderRadius: '8px',
              backgroundColor: 'var(--bg)',
              color: 'var(--tx)',
              outline: 'none',
              opacity: loading ? 0.6 : 1,
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--pri)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--panel2)')}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--pri)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: loading ? 0.8 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={16} />}
            {loading ? 'Checking...' : 'Check Now'}
          </button>
        </div>
        <RecentChecks items={recent} onPick={(h) => { setUrl(h); checkUrl(h); }} onClear={() => { setRecent([]); saveRecent(RECENT_KEY, []); }} />
      </form>

      {/* Error */}
      {error && (
        <div style={{ padding: '16px', backgroundColor: '#FFF0ED', border: '1px solid #FFD9D2', borderRadius: '8px', marginBottom: '24px', color: '#D72C0D' }}>
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ 
          padding: '24px', 
          backgroundColor: 'var(--panel)', 
          border: '1px solid var(--panel2)',
          borderRadius: '12px',
          marginBottom: '24px'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ padding: '12px', backgroundColor: getStatusBg(), borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {getStatusIcon()}
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: getStatusColor() }}>
                  {result.isShopify ? 'Shopify Store Detected!' : 'Not a Shopify Store'}
                </h2>
                {result.confidence > 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--tx3)', marginTop: '4px' }}>
                    Confidence: {Math.round(result.confidence * 100)}%
                  </p>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--panel2)',
                  border: '1px solid var(--panel2)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleVisit}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'var(--panel2)',
                  border: '1px solid var(--panel2)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ExternalLink size={14} />
                Visit
              </button>
            </div>
          </div>

          {/* URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'var(--bg)', borderRadius: '6px', marginBottom: '16px', fontSize: '12px', fontFamily: 'monospace' }}>
            <Globe size={14} style={{ color: 'var(--tx3)' }} />
            <span style={{ wordBreak: 'break-all' }}>{result.url}</span>
            {result.shop_domain && <span style={{ color: 'var(--good)', fontWeight: 600, marginLeft: 'auto' }}>{result.shop_domain}</span>}
          </div>

          {/* Message */}
          <div style={{ padding: '12px', backgroundColor: getStatusBg(), borderRadius: '6px', marginBottom: '16px' }}>
            <p style={{ fontWeight: 600, color: getStatusColor() }}>{result.message}</p>
            {result.details && <p style={{ fontSize: '12px', color: 'var(--tx)', marginTop: '4px' }}>{result.details}</p>}
          </div>

          {/* Confidence Meter */}
          {result.isShopify && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ fontWeight: 500 }}>Detection Confidence</span>
                <span style={{ fontWeight: 600, color: 'var(--good)' }}>{Math.round(result.confidence * 100)}%</span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--panel2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${result.confidence * 100}%`,
                    background: result.confidence > 0.7 ? 'linear-gradient(90deg, #00A56A 0%, #008060 100%)' : result.confidence > 0.3 ? 'linear-gradient(90deg, #FFC453 0%, #FFB020 100%)' : 'linear-gradient(90deg, #E34850 0%, #D72C0D 100%)',
                    transition: 'width 0.8s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Technical Details */}
          {result.detected_signals && result.detected_signals.length > 0 && (
            <div>
              <button
                onClick={() => setShowTechnical(!showTechnical)}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--panel2)',
                  border: 'none',
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
                <ChevronDown size={16} style={{ transform: showTechnical ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
              </button>
              {showTechnical && (
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg)', borderRadius: '6px', fontSize: '12px' }}>
                  {result.detected_signals.map((signal, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: i < result.detected_signals.length - 1 ? '1px solid var(--panel2)' : 'none' }}>
                      • {signal}
                    </div>
                  ))}
                  {result.elapsed_ms > 0 && <p style={{ marginTop: '8px', color: 'var(--tx3)' }}>Detection took {result.elapsed_ms}ms</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
