import { useState, useEffect, useRef } from "react";
import { analyzeShopify, applyHeaderSignals, fetchPageSource, buildReport, serverCheck } from "../lib/shopify.js";
import { readParams, writeParams } from "../hooks/index.js";

export default function ShopifyTool({ notify, arg }) {
  const [url, setUrl] = useState(() => arg || readParams().get("u") || "");
  const [html, setHtml] = useState("");
  useEffect(() => { writeParams({ u: url.trim() || null }); }, [url]);
  const [state, setState] = useState("idle"); // idle|scanning|done|blocked
  const [res, setRes] = useState(null);
  const [ms, setMs] = useState(null);
  const [via, setVia] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [headers, setHeaders] = useState(null);
  const autoRan = useRef(false);

  const scan = async () => {
    const u = url.trim();
    if (!u && !html.trim()) { notify("Paste a URL or page source first."); return; }
    setState("scanning"); setRes(null); setMs(null); setVia(false); setHeaders(null);
    if (html.trim()) {
      await new Promise((r) => setTimeout(r, 700));
      setRes(analyzeShopify(html, u)); setState("done"); return;
    }
    let full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    try { new URL(full); } catch { notify("That doesn't look like a valid URL."); setState("idle"); return; }
    if (/\.myshopify\.com$/i.test(new URL(full).hostname)) { setRes(analyzeShopify("", full)); setState("done"); return; }
    /* 1. the ToolDeck API, when deployed — reads response headers (conclusive) */
    const api = await serverCheck(full);
    if (api) {
      setMs(api.elapsed_ms ?? null);
      setHeaders(api.headers_sample && Object.keys(api.headers_sample).length ? api.headers_sample : null);
      setRes({
        verdict: api.verdict ?? (api.is_shopify ? "yes" : "no"),
        confidence: api.confidence_pct ?? Math.round((api.confidence ?? 0) * 100),
        hits: api.signals_detail ?? (api.detected_signals ?? []).map((label) => ({ label, w: "" })),
        plus: !!api.plus, theme: api.theme ?? null, shopDomain: api.shop_domain ?? null,
        currency: api.currency ?? null, signalsChecked: 15,
      });
      setState("done"); return;
    }
    /* 2. browser fetch chain (direct → read-only proxies) */
    try {
      const t0 = performance.now();
      const { text, viaProxy } = await fetchPageSource(full);
      setMs(Math.round(performance.now() - t0));
      setVia(viaProxy);
      setRes(analyzeShopify(text, full)); setState("done");
    } catch {
      setState("blocked");
    }
  };

  /* prefix trick — /tool/shopify/<domain> lands here and checks immediately */
  useEffect(() => {
    if (arg && !autoRan.current) { autoRan.current = true; scan(); }
  }, [arg]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid2">
      <div className="panel rise d1">
        <div className="ph"><h3>Check a website</h3><p>Nine independent Shopify signals scored into one confidence value.</p></div>
        <div className="pb">
          <div className="field"><label htmlFor="surl">Store URL</label>
            <input id="surl" type="text" placeholder="https://store-example.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scan()} /></div>
          <div className="field"><label htmlFor="shtml">Or paste the page source (view-source)</label>
            <textarea id="shtml" placeholder="Optional — paste HTML here when the site blocks direct fetching" value={html} onChange={(e) => setHtml(e.target.value)} /></div>
          <button className="btn pri" onClick={scan} disabled={state === "scanning"}>{state === "scanning" ? "Scanning…" : "Check for Shopify"}</button>
          {url.trim() && <button className="btn gh" style={{ width: "100%", marginTop: 10 }} onClick={() => navigator.clipboard.writeText(window.location.href).then(() => notify("Link copied — reopens this URL.")).catch(() => notify("Copy blocked."))}>🔗 Share this check</button>}
          <div className="note i" style={{ marginTop: 14 }}>
            <b>How it fetches · </b>with the ToolDeck API deployed it checks server-side and reads response headers — the
            strongest evidence there is. Otherwise it tries the site directly, then read-only public proxies. If a store
            still blocks all of them, paste the page source above. Detection is never 100% — headless or heavily customised
            stores can hide the usual signals.
          </div>
          <div className="note i" style={{ marginTop: 10 }}>
            <b>Prefix trick · </b>add <span style={{ fontFamily: "var(--mono)", color: "var(--pri2)" }}>tooldeck.in/tool/shopify/</span> before
            any domain — e.g. <span style={{ fontFamily: "var(--mono)" }}>tooldeck.in/tool/shopify/store-example.com</span> — and it
            checks instantly. Handy from the browser address bar.
          </div>
          <button className="sh-toggle" onClick={() => setShowApi((v) => !v)} aria-expanded={showApi} style={{ marginTop: 12 }}>
            <span>{showApi ? "▴" : "▾"}</span> API for CRM / Zapier / n8n
          </button>
          {showApi && (
            <div className="sh-tech">
              <div className="sh-sect">Endpoint (once deployed with Supabase)</div>
              <pre className="sh-code">GET {"{SUPABASE_URL}"}/functions/v1/shopify-check?url=store-example.com</pre>
              <div className="sh-sect" style={{ marginTop: 12 }}>Example response</div>
              <pre className="sh-code">{`{
  "input_url": "store-example.com",
  "final_url": "https://store-example.com/",
  "is_shopify": true,
  "verdict": "yes",
  "confidence": 0.95,
  "shop_domain": "example.myshopify.com",
  "theme": "Dawn",
  "plus": false,
  "detected_signals": ["x-shopify-stage response header", "…"],
  "headers_sample": { "x-shopify-stage": "production" },
  "elapsed_ms": 234
}`}</pre>
              <div className="hint" style={{ marginTop: 8 }}>
                Automate lead qualification: drop the URL into an n8n / Zapier / Make HTTP node and branch on
                <span style={{ fontFamily: "var(--mono)" }}> is_shopify</span>. Results are cached ~10 min server-side.
                Deploy notes: <span style={{ fontFamily: "var(--mono)" }}>supabase/functions/shopify-check</span>.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel rise d2">
        {state === "idle" && <div className="empty">Results appear here — verdict, confidence score and every matched signal.</div>}
        {state === "scanning" && (
          <div style={{ padding: 24 }}>
            <div style={{ position: "relative", height: 130, borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)", overflow: "hidden" }}>
              <div className="pv-scan" style={{ top: "10%" }} />
              <div className="empty" style={{ padding: "44px 20px" }}>Scanning page signals…</div>
            </div>
          </div>
        )}
        {state === "blocked" && (
          <div className="empty">
            The site (or this sandboxed preview) blocked a direct browser read — that's normal.<br /><br />
            Open the site, press <b style={{ color: "var(--tx)" }}>Ctrl+U</b> (view source), copy everything, paste it into the
            source box and scan again. Or deploy with the server proxy for one-click checks.
          </div>
        )}
        {state === "done" && res && (
          <div style={{ padding: 22 }}>
            {/* verdict banner + actions */}
            <div className="sh-hero">
              <div className={`sh-badge ${res.verdict}`}>{res.verdict === "yes" ? "✓" : res.verdict === "uncertain" ? "?" : "✕"}</div>
              <div style={{ minWidth: 0 }}>
                <div className={`verdict ${res.verdict}`} style={{ textAlign: "left", margin: 0 }}>
                  {res.verdict === "yes" ? "Shopify store detected!" : res.verdict === "uncertain" ? "Possibly Shopify" : "No Shopify signals found"}
                </div>
                <div style={{ fontSize: 13, color: "var(--tx3)", marginTop: 2 }}>Confidence: {res.confidence}%</div>
              </div>
              <div className="sh-acts">
                <button className="pill" onClick={() => navigator.clipboard.writeText(buildReport(res, url.trim() || "(pasted source)", ms)).then(() => notify("Report copied — paste it into your CRM.")).catch(() => notify("Copy blocked."))}>⧉ Copy report</button>
                {url.trim() && <a className="pill" href={/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`} target="_blank" rel="noopener noreferrer">↗ Visit</a>}
              </div>
            </div>
            {/* checked url + shop identity */}
            {(url.trim() || res.shopDomain) && (
              <div className="sh-urlrow">
                <span className="u">🌐 {url.trim() || "pasted page source"}</span>
                {res.shopDomain && <span className="d">{res.shopDomain}</span>}
              </div>
            )}
            {/* callout */}
            <div className={`sh-callout ${res.verdict}`}>
              {res.verdict === "yes" && <>
                <b>✅ This is a Shopify store{res.plus ? " — with Plus indicators" : ""}!</b>
                <span>{res.shopDomain ? `Shop domain: ${res.shopDomain} · ` : ""}{res.hits.length} Shopify signal{res.hits.length === 1 ? "" : "s"} detected{res.theme ? ` · theme “${res.theme}”` : ""}</span>
              </>}
              {res.verdict === "uncertain" && <>
                <b>🤔 Some Shopify markers, but not conclusive.</b>
                <span>{res.hits.length} of {res.signalsChecked} signals matched — could be headless Shopify or a heavily customised build.</span>
              </>}
              {res.verdict === "no" && <>
                <b>Not a Shopify store, as far as the page shows.</b>
                <span>0 strong signals in the analysed source. Headless setups can hide markers — try the checkout page's source too.</span>
              </>}
            </div>
            {/* confidence bar */}
            <div className="sh-barwrap">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "var(--tx2)", fontWeight: 600 }}>Detection confidence</span>
                <b style={{ color: res.verdict === "yes" ? "var(--good)" : res.verdict === "uncertain" ? "var(--warn)" : "var(--tx3)" }}>{res.confidence}%</b>
              </div>
              <div className="sh-bar"><i className={res.verdict} style={{ width: `${res.confidence}%` }} /></div>
            </div>
            {/* stat cards */}
            <div className="sh-cards">
              <div className="sh-card"><span className="i">🛍</span><span className="k">Platform</span><b>{res.verdict === "yes" ? "Shopify" : res.verdict === "uncertain" ? "Unclear" : "Other"}</b></div>
              <div className="sh-card"><span className="i">🛡</span><span className="k">SSL</span><b>{/^http:\/\//i.test(url.trim()) ? "None ⚠" : "Secure"}</b></div>
              <div className="sh-card"><span className="i">⚡</span><span className="k">Response</span><b>{ms == null ? "—" : ms < 800 ? "Fast" : ms < 2500 ? "OK" : "Slow"}{ms != null && <small> {ms} ms</small>}</b></div>
            </div>
            {/* technical details */}
            <button className="sh-toggle" onClick={() => setShowTech((v) => !v)} aria-expanded={showTech}>
              <span>{showTech ? "▴" : "▾"}</span> {showTech ? "Hide" : "Show"} technical details
            </button>
            {showTech && (
              <div className="sh-tech">
                <div className="sh-sect">Detected signals ({res.hits.length}/{res.signalsChecked})</div>
                {res.hits.length === 0 && <div className="empty" style={{ padding: 14 }}>No known Shopify markers matched in the analysed source.</div>}
                {res.hits.map((h) => (
                  <div className="sigrow" key={h.label}><span style={{ color: "var(--good)" }}>✓</span>{h.label}<span className="w">+{h.w}</span></div>
                ))}
                <div className="sh-sect" style={{ marginTop: 14 }}>Fetch details</div>
                <div className="kv" style={{ padding: "7px 0" }}><span className="k">Fetched via</span><span className="v">{html.trim() ? "pasted source" : headers ? "ToolDeck API (server)" : via ? "read-only proxy" : "direct request"}</span></div>
                {ms != null && <div className="kv" style={{ padding: "7px 0" }}><span className="k">Response time</span><span className="v" style={{ fontFamily: "var(--mono)" }}>{ms} ms</span></div>}
                {res.currency && <div className="kv" style={{ padding: "7px 0" }}><span className="k">Store currency</span><span className="v">{res.currency}</span></div>}
                {res.theme && <div className="kv" style={{ padding: "7px 0" }}><span className="k">Theme</span><span className="v">{res.theme}</span></div>}
                {res.plus && <div style={{ marginTop: 8 }}><span className="chip act">SHOPIFY PLUS INDICATOR</span></div>}
                {headers && <>
                  <div className="sh-sect" style={{ marginTop: 14 }}>Headers sample</div>
                  {Object.entries(headers).map(([k, v]) => (
                    <div className="kv" key={k} style={{ padding: "6px 0" }}>
                      <span className="k" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{k}</span>
                      <span className="v" style={{ fontFamily: "var(--mono)", fontSize: 12, overflowWrap: "anywhere" }}>{String(v)}</span>
                    </div>
                  ))}
                </>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
