import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import {
  AlertTriangle, ArrowRight, Bell, CircleCheck, ExternalLink, LineChart, Minus, Package, RefreshCw, Search, Table2,
  TrendingDown, TrendingUp,
} from "lucide-react";
import { ShareLink } from "../components/chrome.jsx";
import { Notice, StatusBadge, EmptyState } from "../components/ui.jsx";
import { readParams, writeParams } from "../hooks/index.js";
import { lookupPrice, UNAVAILABLE } from "../features/priceTracker/api.js";
import PriceChart from "../features/priceTracker/PriceChart.jsx";
import { parseProductUrl } from "../../shared/priceTrackerCore/amazonUrl.mjs";
import { priceStats } from "../../shared/priceTrackerCore/series.mjs";
import "./css/price.css";

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
/* problems with the link itself — retrying the same link can't help */
const LINK_ERRORS = ["invalid_url", "unsupported_store", "unsupported_marketplace", "no_product_id", "short_link_unresolved"];

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
  /* read the shared-link params once, before the URL-sync effect below can rewrite them */
  const [initial] = useState(() => ({ p: readParams().get("p") || "", t: readParams().get("t") || "" }));
  const [url, setUrl] = useState(initial.p);
  const [state, setState] = useState({ kind: "idle" });   // idle | loading | error | ready
  const [range, setRange] = useState(null);
  const [target, setTarget] = useState(initial.t);
  const [alertOpen, setAlertOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const ctrl = useRef(null);

  /* during a re-check the previous result stays on screen (dimmed) instead of flickering away */
  const product = state.kind === "ready" ? state.product : state.kind === "loading" ? state.previous : null;
  const money = useMoney(product?.currency);

  useEffect(() => {
    // keep the shared link's params until its lookup has settled
    if (!product && (state.kind === "loading" || (state.kind === "idle" && initial.p))) return;
    // a lookup that failed on our side (not a bad link) keeps its link, so a reload retries it
    const retryable = state.kind === "error" && state.input ? state.input : null;
    writeParams({ p: product ? product.canonicalUrl : retryable, t: (product || retryable) && target ? target : null });
  }, [product, target, state, initial]);

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
      /* a superseded/unmounted lookup can also fail with a non-Abort error (e.g. its body read was cut off) */
      if (e?.name === "AbortError" || c.signal.aborted) return;
      setState({ kind: "error", code: e.code, message: e.message || UNAVAILABLE, detail: e.detail, input });
    }
  }, [notify]);

  /* shared links (?p=…) look the product up straight away */
  useEffect(() => { if (initial.p) lookup(initial.p); return () => ctrl.current?.abort(); }, [lookup, initial]);

  const coverageDays = product && product.observations.length
    ? (Date.now() - new Date(product.observations[0].observedAt).getTime()) / DAY : 0;
  const ranges = RANGES.filter(([, d]) => d == null || coverageDays > d * 0.5);
  const activeRange = ranges.some(([, d]) => d === range) ? range : null;

  const stats = useMemo(() => (product ? priceStats(product.observations, {
    now: Date.now(), rangeDays: activeRange, asOf: product.lastObservedAt,
  }) : null), [product, activeRange]);

  const loading = state.kind === "loading";
  const shown = product;
  const readings = product ? product.observations.filter((o) => o.price != null).length : 0;
  const multi = product ? product.observations.length > 1 : false;

  return (
    <div className="pt">
      <div className="panel rise d1">
        <div className="pb">
          <form noValidate className="pt-form" onSubmit={(e) => { e.preventDefault(); lookup(url); }}>
            <div className="field">
              <label htmlFor="purl">Amazon product link</label>
              <div className="inrow stack">
                <input id="purl" className="mono" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
                  aria-describedby="purl-hint"
                  placeholder="https://www.amazon.in/dp/…  or  https://amzn.in/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
                <button className="btn pri" type="submit" disabled={loading}>
                  {loading ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
                  {loading ? "Checking…" : "Track price"}
                </button>
              </div>
              <div className="hint" id="purl-hint">Amazon.in links in any format — app share links, mobile links and links with tracking tags all work.</div>
            </div>
          </form>
        </div>
      </div>

      {/* a short announcement instead of a live region around the whole result */}
      <p className="sr-only" role="status">
        {state.kind === "ready" ? (product.currentPrice != null ? `Current price ${money(product.currentPrice)}` : UNAVAILABLE) : loading ? "Checking the live price…" : ""}
      </p>

      <div className="pt-out" aria-busy={loading}>
        {state.kind === "idle" && (
          <div className="panel rise d2">
            <EmptyState icon={LineChart} title="Should you buy now, or wait?">
              Paste an Amazon product link to see its live price, the price history we've recorded, and set a price-drop alert.
            </EmptyState>
          </div>
        )}

        {loading && !shown && (
          <div className="panel rise d2" role="status" aria-label="Fetching the live price from Amazon">
            <div className="pb">
              <div className="pt-head">
                <div className="skel pt-img" />
                <div className="pt-meta">
                  <div className="skel pt-sk-line" />
                  <div className="skel pt-sk-line pt-sk-short" />
                  <div className="skel pt-sk-price" />
                </div>
              </div>
              <div className="hint">Fetching the live price from Amazon…</div>
            </div>
          </div>
        )}

        {state.kind === "error" && (
          <Notice tone={state.code === "network" ? "off" : LINK_ERRORS.includes(state.code) ? "w" : "e"} role="alert" className="pt-err rise d2"
            title={state.message || UNAVAILABLE}
            actions={!LINK_ERRORS.includes(state.code) && (
              <button type="button" className="btn gh sm" onClick={() => lookup(url)}><RefreshCw size={14} aria-hidden="true" />Try again</button>
            )}>
            {(state.detail || ERROR_HELP[state.code]) && <p>{state.detail || ERROR_HELP[state.code]}</p>}
          </Notice>
        )}

        {shown && (
          <section className={`panel rise d2 pt-result${loading ? " pt-dim" : ""}`} aria-labelledby="pt-title">
            <div className="pb">
              <div className="pt-head">
                {shown.image
                  ? <img className="pt-img" src={shown.image} alt="" width="96" height="96" loading="lazy" referrerPolicy="no-referrer" />
                  : <div className="pt-img pt-img-none" aria-hidden="true"><Package size={30} strokeWidth={1.6} /></div>}
                <div className="pt-meta">
                  <h2 className="pt-title" id="pt-title" title={shown.title || undefined}>{shown.title || `Amazon product ${shown.externalId}`}</h2>
                  <div className="badges pt-badges">
                    {shown.availability && (
                      <StatusBadge tone={shown.currentPrice == null ? "warn" : "ok"} icon={shown.currentPrice == null ? AlertTriangle : CircleCheck}>{shown.availability}</StatusBadge>
                    )}
                    <StatusBadge>{shown.marketplace.replace(/^amazon/, "Amazon")}</StatusBadge>
                    <StatusBadge><span className="pt-asin">ASIN {shown.externalId}</span></StatusBadge>
                  </div>
                </div>
              </div>

              <div className="pt-hero">
                <div className="pt-eyebrow">Current price</div>
                <div className="pt-price-row">
                  <span className="pt-price">{shown.currentPrice != null ? money(shown.currentPrice) : "Price unavailable"}</span>
                  {shown.currentPrice != null && shown.originalPrice != null && shown.originalPrice > shown.currentPrice && (
                    <span className="pt-was">
                      <s><span className="sr-only">List price </span>{money(shown.originalPrice)}</s> {Math.round((1 - shown.currentPrice / shown.originalPrice) * 100)}% off
                    </span>
                  )}
                </div>
                {stats && shown.currentPrice != null && <PriceChange stats={stats} money={money} current={shown.currentPrice} multi={multi} />}
                <div className="pt-asof">
                  {shown.lastObservedAt ? <>Price as of <time dateTime={shown.lastObservedAt}>{fmtWhen(shown.lastObservedAt)}</time></> : "Not yet checked"}
                  {shown.seller && <> · Sold by {shown.seller}</>}
                </div>
              </div>

              {stats && <Verdict stats={stats} money={money} range={activeRange} />}

              {shown.warning && (
                <Notice tone="w" title={UNAVAILABLE}>Showing the last price we confirmed, from {fmtWhen(shown.lastObservedAt)}.</Notice>
              )}

              <div className="actions pt-actions">
                <a className="btn gh sm" href={shown.buyUrl} target="_blank" rel="nofollow sponsored noopener noreferrer">
                  View on Amazon<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
                <button type="button" className="btn gh sm" onClick={() => lookup(shown.canonicalUrl)} disabled={loading}>
                  <RefreshCw size={14} className={loading ? "spin" : undefined} aria-hidden="true" />{loading ? "Checking…" : "Check again"}
                </button>
                <ShareLink notify={notify} />
              </div>
              <p className="pt-disclaimer">Prices and availability are accurate as of the time shown and are subject to change. The price on Amazon at the time of purchase applies.</p>
            </div>
          </section>
        )}

        {product && stats && (
          <section className="panel rise d3 pt-history" aria-labelledby="pt-hist-h">
            <div className="pb">
              <div className="pt-hist-head">
                <h2 id="pt-hist-h">Price history</h2>
                {ranges.length > 1 && (
                  <div className="seg pt-range" role="group" aria-label="Time range">
                    {ranges.map(([l, d]) => <button type="button" key={l} aria-pressed={activeRange === d} onClick={() => setRange(d)}>{l}</button>)}
                  </div>
                )}
              </div>

              <div className="metrics pt-stats">
                <StatCell label="Lowest" value={money(stats.lowest?.price)} sub={stats.lowest && fmtDay(stats.lowest.observedAt)} tone="good" />
                <StatCell label="Highest" value={money(stats.highest?.price)} sub={stats.highest && fmtDay(stats.highest.observedAt)} tone="bad" />
                <StatCell label="Average" value={stats.pointCount > 1 || multi ? money(stats.average) : "—"} sub="time-weighted" />
                <StatCell label="Readings" value={readings} sub={`since ${fmtDay(stats.trackedSince)}`} />
              </div>

              <PriceChart observations={product.observations} start={stats.window.start} end={stats.window.end}
                fmtPrice={money} fmtWhen={fmtWhen} sourceLabel={sourceLabel} lowest={stats.lowest} highest={stats.highest} />

              {stats.pointCount <= 1 && product.observations.length <= 1 && (
                <Notice tone="i" title="Tracking started — history appears as readings are recorded.">
                  {isToday(stats.trackedSince)
                    ? "Price tracking started today. More history will appear as we continue monitoring this product."
                    : `Tracking since ${fmtDay(stats.trackedSince)}. More history will appear as we continue monitoring this product.`}
                </Notice>
              )}

              <div className="pt-histfoot">
                <p className="pt-source">
                  History is built only from real readings: ToolDeck checks this price every few hours{product.historyImported ? ", and earlier history was imported from Keepa" : ""}. Average is weighted by how long each price lasted.
                </p>
                <button type="button" className="btn gh sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} aria-controls="pt-readings">
                  <Table2 size={14} aria-hidden="true" />{showTable ? "Hide readings" : "Show all readings"}
                </button>
              </div>
              {showTable && <ReadingsTable observations={product.observations} money={money} />}
            </div>
          </section>
        )}

        {product && stats && (
          <section className="panel rise d4 pt-alert" aria-labelledby="pt-alert-h">
            <div className="pb">
              <div className="pt-alert-head">
                <div>
                  <h2 id="pt-alert-h">Price-drop alert</h2>
                  <p>We check tracked products every hour while an alert is set and notify you when the price is at or below your target.</p>
                </div>
                <button type="button" className="btn qt sm" onClick={() => nav("/tool/price/alerts")}>My alerts<ArrowRight size={14} aria-hidden="true" /></button>
              </div>
              <div className="field pt-target">
                <label htmlFor="tprice">Target price ({product.currency || "INR"})</label>
                <div className="inrow stack">
                  <input id="tprice" className="mono" type="number" min="1" inputMode="decimal"
                    placeholder={product.currentPrice ? `e.g. ${Math.floor(product.currentPrice * 0.9)}` : ""} value={target} onChange={(e) => setTarget(e.target.value)} />
                  <button type="button" className="btn" onClick={() => setAlertOpen(true)} disabled={product.currentPrice == null}>
                    <Bell size={15} aria-hidden="true" />Create alert
                  </button>
                </div>
                {product.currentPrice == null && <div className="hint">Alerts need a live price — {UNAVAILABLE.charAt(0).toLowerCase() + UNAVAILABLE.slice(1)}</div>}
              </div>
            </div>
          </section>
        )}
      </div>

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

function StatCell({ label, value, sub, tone }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className={`v${tone ? ` pt-${tone}` : ""}`}>{value}</div>
      {sub && <div className="pt-msub">{sub}</div>}
    </div>
  );
}

/* Change of the live price against the first reading in the selected range, and against the recorded high.
   Direction is always spelled out in words next to the arrow — never colour alone. */
function PriceChange({ stats, money, current, multi }) {
  const ch = stats.change;
  const offHigh = stats.highest && stats.highest.price > current ? stats.highest.price - current : 0;
  return (
    <div className="pt-change">
      {ch && ch.amount !== 0 ? (
        <span className={`pt-delta ${ch.amount < 0 ? "down" : "up"}`}>
          {ch.amount < 0 ? <TrendingDown size={15} aria-hidden="true" /> : <TrendingUp size={15} aria-hidden="true" />}
          {ch.amount < 0 ? "Down" : "Up"} {Math.abs(ch.percent).toFixed(1)}% ({money(Math.abs(ch.amount))}) since {fmtDay(ch.since)}
        </span>
      ) : (
        <span className="pt-delta flat">
          <Minus size={15} aria-hidden="true" />{multi ? `No change since ${fmtDay(ch?.since || stats.trackedSince)}` : "One reading so far"}
        </span>
      )}
      {offHigh > 0 && <span className="pt-offhigh">{money(offHigh)} below the highest recorded ({money(stats.highest.price)})</span>}
    </div>
  );
}

/* One-line buy-or-wait verdict — only from the real-data insight in priceStats. */
function Verdict({ stats, money, range }) {
  if (!stats.insight) {
    // no live price, or enough history but no opinion — say nothing rather than guess
    if (!stats.current || stats.enoughHistory) return null;
    return (
      <p className="pt-verdict none">
        <LineChart size={16} aria-hidden="true" />
        <span><b>No verdict yet.</b> We need about two weeks of recorded readings before comparing today's price with its usual range.</span>
      </p>
    );
  }
  const pct = Math.abs(stats.insight.vsAverage).toFixed(0);
  const span = range ? `${range}-day` : "recorded";
  const [lead, Icon, text] = {
    lowest: ["Looks like a good time to buy.", TrendingDown, <>Lowest price we've recorded since {new Date(stats.trackedSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}.</>],
    low: ["Looks like a good time to buy.", TrendingDown, <>Lower than usual — {pct}% below the {span} average of {money(stats.average)}.</>],
    high: ["You may want to wait.", TrendingUp, <>Higher than usual — {pct}% above the {span} average of {money(stats.average)}. Consider setting an alert.</>],
    typical: ["Fair price.", Minus, <>Typical price — within {pct}% of the {span} average of {money(stats.average)}.</>],
  }[stats.insight.kind];
  return (
    <p className={`pt-verdict ${stats.insight.kind}`}>
      <Icon size={16} aria-hidden="true" />
      <span><b>{lead}</b> {text}</span>
    </p>
  );
}

function ReadingsTable({ observations, money }) {
  const rows = [...observations].reverse();
  const MAX = 300;
  return (
    <div className="pt-table-wrap" id="pt-readings" tabIndex={0} role="region" aria-label="All price readings">
      <table className="rt pt-table">
        <caption className="sr-only">Every recorded price reading, newest first</caption>
        <thead><tr><th scope="col">Observed</th><th scope="col">Price</th><th scope="col">Availability</th><th scope="col">Source</th></tr></thead>
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
      {rows.length > MAX && <div className="hint pt-table-more">Showing the latest {MAX} of {rows.length} readings.</div>}
    </div>
  );
}
