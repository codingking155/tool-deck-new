import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { ShareLink } from "../components/chrome.jsx";
import { readParams, writeParams } from "../hooks/index.js";
import { lookupPrice, UNAVAILABLE } from "../features/priceTracker/api.js";
import PriceChart from "../features/priceTracker/PriceChart.jsx";
import { parseProductUrl } from "../../shared/priceTrackerCore/amazonUrl.mjs";
import { priceStats } from "../../shared/priceTrackerCore/series.mjs";

/* The alert dialog (and its validation core) only loads when someone opens it. */
const SetPriceAlert = lazy(() => import("../features/priceAlerts/SetPriceAlert.jsx"));

const DAY = 86_400_000;
const RANGES = [["30 days", 30], ["3 months", 91], ["6 months", 182], ["1 year", 365], ["All", null]];
const SOURCES = { "amazon-paapi": "Amazon Product Advertising API", "keepa-amazon": "Keepa · sold by Amazon", "keepa-new": "Keepa · lowest new offer" };
const sourceLabel = (s) => SOURCES[s] || s;

const ERROR_HELP = {
  not_configured: "Live price data isn't connected on this deployment yet.",
  network: "The price service couldn't be reached. Check your connection and try again.",
  rate_limited: "Too many lookups in a short time. Please wait a minute and try again.",
  not_found: null, unsupported_store: null, unsupported_marketplace: null, no_product_id: null, invalid_url: null,
  short_link_unresolved: null,
};

function useMoney(currency) {
  return useMemo(() => {
    const cur = currency || "INR";
    const loc = cur === "INR" ? "en-IN" : undefined;
    let full, compact;
    try {
      full = new Intl.NumberFormat(loc, { style: "currency", currency: cur, maximumFractionDigits: 2, minimumFractionDigits: 0 });
      compact = new Intl.NumberFormat(loc, { style: "currency", currency: cur, maximumFractionDigits: 0 });
    } catch {
      full = compact = { format: (n) => `${cur} ${Number(n).toFixed(2)}` };
    }
    return (n, short) => (n == null ? "—" : (short ? compact : full).format(n));
  }, [currency]);
}

const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

export default function PriceTool({ notify, nav }) {
  const [url, setUrl] = useState(() => readParams().get("p") || "");
  const [state, setState] = useState({ kind: "idle" });   // idle | loading | error | ready
  const [range, setRange] = useState(null);
  const [target, setTarget] = useState(() => readParams().get("t") || "");
  const [alertOpen, setAlertOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const ctrl = useRef(null);

  /* during a re-check the previous result stays on screen (dimmed) instead of flickering away */
  const product = state.kind === "ready" ? state.product : state.kind === "loading" ? state.previous : null;
  const money = useMoney(product?.currency);

  useEffect(() => {
    writeParams({ p: product ? product.canonicalUrl : null, t: product && target ? target : null });
  }, [product, target]);

  const lookup = useCallback(async (raw) => {
    const input = String(raw || "").trim();
    if (!input) { notify("Paste an Amazon product link."); return; }
    const parsed = parseProductUrl(input);
    if (!parsed.ok && parsed.code !== "short_link") { setState({ kind: "error", code: parsed.code, message: parsed.message }); return; }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ kind: "loading", previous: s.kind === "ready" ? s.product : s.kind === "loading" ? s.previous : null }));
    try {
      const p = await lookupPrice(input, { signal: c.signal });
      if (c.signal.aborted) return;
      setState({ kind: "ready", product: p });
      setShowTable(false);
      if (p.canonicalUrl) setUrl(p.canonicalUrl);
    } catch (e) {
      if (e?.name === "AbortError") return;
      setState({ kind: "error", code: e.code, message: e.message || UNAVAILABLE, detail: e.detail });
    }
  }, [notify]);

  /* shared links (?p=…) look the product up straight away */
  useEffect(() => { const p = readParams().get("p"); if (p) lookup(p); return () => ctrl.current?.abort(); }, [lookup]);

  const coverageDays = product && product.observations.length
    ? (Date.now() - new Date(product.observations[0].observedAt).getTime()) / DAY : 0;
  const ranges = RANGES.filter(([, d]) => d == null || coverageDays > d * 0.5);
  const activeRange = ranges.some(([, d]) => d === range) ? range : null;

  const stats = useMemo(() => (product ? priceStats(product.observations, {
    now: Date.now(), rangeDays: activeRange, asOf: product.lastObservedAt,
  }) : null), [product, activeRange]);

  const loading = state.kind === "loading";
  const shown = product;

  return (
    <div>
      <div className="panel rise d1" style={{ marginBottom: 18 }}>
        <div className="pb" style={{ paddingTop: 18 }}>
          <form noValidate className="two" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}
            onSubmit={(e) => { e.preventDefault(); lookup(url); }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="purl">Amazon product link</label>
              <input id="purl" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
                placeholder="https://www.amazon.in/dp/…  or  https://amzn.in/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <button className="btn pri" type="submit" style={{ width: "auto", height: 44 }} disabled={loading}>
              {loading ? "Checking…" : "Track price"}
            </button>
          </form>
          <div className="hint">Amazon.in links in any format — app share links, mobile links and links with tracking tags all work.</div>
        </div>
      </div>

      {state.kind === "idle" && (
        <div className="empty rise d2">Paste an Amazon product link to see its live price, the price history we've recorded, and set a price-drop alert.</div>
      )}

      {loading && !shown && (
        <div className="panel rise d2" aria-busy="true">
          <div className="pb" style={{ paddingTop: 18 }}>
            <div className="pt-head">
              <div className="skel" style={{ width: 96, height: 96 }} />
              <div style={{ flex: 1 }}><div className="skel" style={{ height: 18, marginBottom: 10 }} /><div className="skel" style={{ height: 18, width: "60%", marginBottom: 14 }} /><div className="skel" style={{ height: 34, width: 160 }} /></div>
            </div>
            <div className="hint" style={{ marginTop: 12 }}>Fetching the live price from Amazon…</div>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="panel rise d2" role="alert">
          <div className="pb" style={{ paddingTop: 18 }}>
            <div className="pt-err-title">{state.message || UNAVAILABLE}</div>
            {(state.detail || ERROR_HELP[state.code]) && <div className="hint" style={{ marginTop: 6 }}>{state.detail || ERROR_HELP[state.code]}</div>}
            {!["invalid_url", "unsupported_store", "unsupported_marketplace", "no_product_id", "short_link_unresolved"].includes(state.code) && (
              <button className="btn gh" style={{ marginTop: 14 }} onClick={() => lookup(url)}>Try again</button>
            )}
          </div>
        </div>
      )}

      {shown && (
        <div className={`panel rise d2${loading ? " pt-dim" : ""}`}>
          <div className="pb" style={{ paddingTop: 18 }}>
            {/* ── product ── */}
            <div className="pt-head">
              {shown.image
                ? <img className="pt-img" src={shown.image} alt="" width="96" height="96" loading="lazy" referrerPolicy="no-referrer" />
                : <div className="pt-img pt-img-none" aria-hidden="true">📦</div>}
              <div className="pt-meta">
                <h3 className="pt-title">{shown.title || `Amazon product ${shown.externalId}`}</h3>
                <div className="pt-chips">
                  <span className="chip done">{shown.marketplace.replace(/^amazon/, "Amazon")}</span>
                  <span className="chip done">ASIN {shown.externalId}</span>
                  {shown.availability && <span className={`chip ${shown.currentPrice == null ? "wk" : "act"}`}>{shown.availability}</span>}
                </div>
                <div className="pt-price-row">
                  <span className="pt-price">{shown.currentPrice != null ? money(shown.currentPrice) : "Price unavailable"}</span>
                  {shown.currentPrice != null && shown.originalPrice != null && shown.originalPrice > shown.currentPrice && (
                    <span className="pt-was">
                      <s>{money(shown.originalPrice)}</s> {Math.round((1 - shown.currentPrice / shown.originalPrice) * 100)}% off
                    </span>
                  )}
                </div>
                <div className="pt-asof">
                  {shown.lastObservedAt ? <>Price as of {fmtWhen(shown.lastObservedAt)}</> : "Not yet checked"}
                  {shown.seller && <> · Sold by {shown.seller}</>}
                </div>
                <div className="pt-actions">
                  <a className="pill" href={shown.buyUrl} target="_blank" rel="nofollow sponsored noopener noreferrer">View on Amazon ↗</a>
                  <button className="pill" onClick={() => lookup(shown.canonicalUrl)} disabled={loading}>{loading ? "Checking…" : "↻ Check again"}</button>
                </div>
              </div>
            </div>
            {shown.warning && <div className="note w" style={{ marginTop: 12 }}><b>{UNAVAILABLE} </b>Showing the last price we confirmed, from {fmtWhen(shown.lastObservedAt)}.</div>}
            <div className="pt-disclaimer">Prices and availability are accurate as of the time shown and are subject to change. The price on Amazon at the time of purchase applies.</div>
          </div>
        </div>
      )}

      {product && stats && (
        <div className="panel rise d3" style={{ marginTop: 18 }}>
          <div className="pb" style={{ paddingTop: 18 }}>
            <div className="pt-hist-head">
              <h3>Price history</h3>
              {ranges.length > 1 && (
                <div className="rangebar" role="group" aria-label="Time range">
                  {ranges.map(([l, d]) => <button key={l} className={activeRange === d ? "on" : ""} aria-pressed={activeRange === d} onClick={() => setRange(d)}>{l}</button>)}
                </div>
              )}
            </div>

            {stats.insight && <Insight stats={stats} money={money} range={activeRange} />}

            <PriceChart observations={product.observations} start={stats.window.start} end={stats.window.end}
              fmtPrice={money} fmtWhen={fmtWhen} sourceLabel={sourceLabel} lowest={stats.lowest} highest={stats.highest} />

            {stats.pointCount <= 1 && product.observations.length <= 1 && (
              <div className="note i" style={{ marginTop: 10 }}>
                {isToday(stats.trackedSince)
                  ? "Price tracking started today. More history will appear as we continue monitoring this product."
                  : `Tracking since ${fmtDay(stats.trackedSince)}. More history will appear as we continue monitoring this product.`}
              </div>
            )}

            <div className="pstat">
              <div className="pcell"><div className="k">Current</div><div className="v pr">{money(product.currentPrice)}</div></div>
              <div className="pcell"><div className="k">Lowest</div><div className="v gd">{money(stats.lowest?.price)}</div>{stats.lowest && <div className="pt-sub">{fmtDay(stats.lowest.observedAt)}</div>}</div>
              <div className="pcell"><div className="k">Highest</div><div className="v bd">{money(stats.highest?.price)}</div>{stats.highest && <div className="pt-sub">{fmtDay(stats.highest.observedAt)}</div>}</div>
              <div className="pcell"><div className="k">Average</div><div className="v">{stats.pointCount > 1 || product.observations.length > 1 ? money(stats.average) : "—"}</div><div className="pt-sub">time-weighted</div></div>
              <div className="pcell"><div className="k">Change</div>
                {stats.change && stats.change.amount !== 0
                  ? <><div className={`v ${stats.change.amount < 0 ? "gd" : "bd"}`}>{stats.change.amount < 0 ? "▼" : "▲"} {Math.abs(stats.change.percent).toFixed(1)}%</div><div className="pt-sub">since {fmtDay(stats.change.since)}</div></>
                  : <><div className="v">No change</div><div className="pt-sub">{product.observations.length > 1 ? `since ${fmtDay(stats.change?.since || stats.trackedSince)}` : "one reading so far"}</div></>}
              </div>
              <div className="pcell"><div className="k">Readings</div><div className="v">{product.observations.filter((o) => o.price != null).length}</div><div className="pt-sub">since {fmtDay(stats.trackedSince)}</div></div>
            </div>

            <div className="pt-source">
              History is built only from real readings: ToolDeck checks this price every few hours{product.historyImported ? ", and earlier history was imported from Keepa" : ""}. Average is weighted by how long each price lasted.
              {" "}<button className="pt-link" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>{showTable ? "Hide readings" : "Show all readings"}</button>
            </div>
            {showTable && <ReadingsTable observations={product.observations} money={money} />}

            {/* ── target price / alerts ── */}
            <div className="two" style={{ marginTop: 18, gridTemplateColumns: "1fr auto", alignItems: "end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="tprice">Target price</label>
                <input id="tprice" type="number" min="1" inputMode="decimal"
                  placeholder={product.currentPrice ? `e.g. ${Math.floor(product.currentPrice * 0.9)}` : ""} value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <button className="btn pri" style={{ width: "auto", height: 44 }} onClick={() => setAlertOpen(true)} disabled={product.currentPrice == null}>
                Alert me on a price drop
              </button>
            </div>
            <div className="hint">We check tracked products every hour while an alert is set and notify you when the price is at or below your target.</div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <ShareLink notify={notify} />
              <button className="pill" onClick={() => nav("/tool/price/alerts")}>My alerts →</button>
            </div>
          </div>
        </div>
      )}

      {alertOpen && product && (
        <Suspense fallback={null}>
          <SetPriceAlert
            product={{
              id: product.productKey, trackedProductId: product.id, name: product.title, image: product.image,
              url: product.buyUrl, currentPrice: product.currentPrice, currency: product.currency, originalPrice: product.originalPrice,
            }}
            signedIn={false}
            initialTarget={target}
            manageBaseUrl={typeof window !== "undefined" ? `${window.location.origin}/tool/price/alerts` : undefined}
            onClose={() => setAlertOpen(false)}
            onCreated={() => notify("Price alert set. We'll email/WhatsApp you when it drops to your target.")}
          />
        </Suspense>
      )}
    </div>
  );
}

function Insight({ stats, money, range }) {
  const pct = Math.abs(stats.insight.vsAverage).toFixed(0);
  const span = range ? `${range}-day` : "recorded";
  const text = {
    lowest: <>Lowest price we've recorded since {new Date(stats.trackedSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}.</>,
    low: <>Lower than usual — {pct}% below the {span} average of {money(stats.average)}.</>,
    high: <>Higher than usual — {pct}% above the {span} average of {money(stats.average)}. Consider setting an alert.</>,
    typical: <>Typical price — within {pct}% of the {span} average of {money(stats.average)}.</>,
  }[stats.insight.kind];
  return <div className={`pt-insight pt-insight-${stats.insight.kind}`}>{text}</div>;
}

function ReadingsTable({ observations, money }) {
  const rows = [...observations].reverse();
  const MAX = 300;
  return (
    <div className="pt-table-wrap">
      <table className="rt pt-table">
        <thead><tr><th>Observed</th><th>Price</th><th>Availability</th><th>Source</th></tr></thead>
        <tbody>
          {rows.slice(0, MAX).map((o) => (
            <tr key={`${o.observedAt}|${o.source}`}>
              <td>{fmtWhen(o.observedAt)}</td>
              <td>{o.price != null ? money(o.price) : "—"}</td>
              <td>{o.availability || ""}</td>
              <td>{sourceLabel(o.source)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX && <div className="hint">Showing the latest {MAX} of {rows.length} readings.</div>}
    </div>
  );
}
