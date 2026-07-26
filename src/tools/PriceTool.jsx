import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { demoHistory, inr } from "../lib/priceDemo.js";
import { ShareLink } from "../components/chrome.jsx";
import { readParams, writeParams } from "../hooks/index.js";

/* The alert dialog (and its validation core) only loads when someone opens it. */
const SetPriceAlert = lazy(() => import("../features/priceAlerts/SetPriceAlert.jsx"));

const RANGES = [["30 days", 30], ["3 months", 91], ["6 months", 182], ["1 year", 365], ["5 years", 1826]];

export default function PriceTool({ notify, nav }) {
  const [url, setUrl] = useState(() => readParams().get("p") || "");
  const [tracked, setTracked] = useState(() => readParams().get("p") || null);
  const [days, setDays] = useState(() => { const d = +readParams().get("d"); return [30, 91, 182, 365, 1826].includes(d) ? d : 30; });
  const [target, setTarget] = useState(() => readParams().get("t") || "");
  const [alertOpen, setAlertOpen] = useState(false);
  useEffect(() => { writeParams({ p: tracked || null, d: tracked ? days : null, t: tracked && target ? target : null }); }, [tracked, days, target]);
  const platform = /flipkart/i.test(url) ? "Flipkart" : /amazon/i.test(url) ? "Amazon" : null;
  const track = () => {
    if (!url.trim()) { notify("Paste an Amazon.in or Flipkart product URL."); return; }
    setTracked(url.trim());
  };
  const data = useMemo(() => (tracked ? demoHistory(tracked, days) : null), [tracked, days]);
  const stats = useMemo(() => {
    if (!data) return null;
    const ps = data.map((p) => p.price);
    const cur = ps[ps.length - 1], first = ps[0];
    const lo = Math.min(...ps), hi = Math.max(...ps), avg = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
    const chg = ((cur - first) / first) * 100;
    return { cur, lo, hi, avg, chg, deal: cur <= avg * 0.94 ? "Good time to buy" : cur >= avg * 1.06 ? "Price is high — wait" : "Around average" };
  }, [data]);
  const chart = useMemo(() => {
    if (!data) return null;
    const w = 640, h = 200, padx = 8, pady = 14;
    const ps = data.map((p) => p.price);
    const lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || 1;
    const pts = data.map((p, i) => [padx + (i / (data.length - 1)) * (w - padx * 2), pady + (1 - (p.price - lo) / span) * (h - pady * 2)]);
    const dLine = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const minIdx = ps.indexOf(lo);
    return { dLine, min: pts[minIdx], w, h, len: 1600 };
  }, [data]);
  return (
    <div>
      <div className="panel rise d1" style={{ marginBottom: 18 }}>
        <div className="pb" style={{ paddingTop: 18 }}>
          <div className="two" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="purl">Amazon.in or Flipkart product URL</label>
              <input id="purl" type="text" placeholder="https://www.amazon.in/dp/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && track()} />
            </div>
            <button className="btn pri" style={{ width: "auto", height: 44 }} onClick={track}>Track price</button>
          </div>
          {platform && <div className="hint">Detected platform: <b style={{ color: "var(--pri2)" }}>{platform}</b></div>}
          <div className="note w" style={{ marginTop: 12, marginBottom: 0 }}>
            <b>Demo data · </b>this preview draws a simulated history so you can feel the full UX. Real tracking requires a
            backend with licensed/affiliate price feeds and genuine recorded history — analytics for a range are only honest
            once you've actually recorded that range.
          </div>
        </div>
      </div>
      {stats && chart && (
        <div className="panel rise d2">
          <div className="pb" style={{ paddingTop: 18 }}>
            <div className="rangebar">
              {RANGES.map(([l, d]) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{l}</button>)}
            </div>
            <svg className="chart" viewBox={`0 0 ${chart.w} ${chart.h}`} preserveAspectRatio="none" aria-label="Price history chart">
              <path d={chart.dLine} fill="none" stroke="var(--pri2)" strokeWidth="2.2"
                strokeDasharray={chart.len} strokeDashoffset={chart.len} style={{ animation: "dash 1.4s ease forwards" }} />
              <circle cx={chart.min[0]} cy={chart.min[1]} r="5.5" fill="var(--good)" style={{ animation: "pulse 1.8s ease-in-out infinite" }} />
            </svg>
            <div className="pstat">
              <div className="pcell"><div className="k">Current</div><div className="v pr">{inr(stats.cur)}</div></div>
              <div className="pcell"><div className="k">Lowest</div><div className="v gd">{inr(stats.lo)}</div></div>
              <div className="pcell"><div className="k">Highest</div><div className="v bd">{inr(stats.hi)}</div></div>
              <div className="pcell"><div className="k">Average</div><div className="v">{inr(stats.avg)}</div></div>
              <div className="pcell"><div className="k">Change ({days}d)</div><div className={`v ${stats.chg <= 0 ? "gd" : "bd"}`}>{stats.chg > 0 ? "▲" : "▼"} {Math.abs(stats.chg).toFixed(1)}%</div></div>
              <div className="pcell"><div className="k">Verdict</div><div className="v" style={{ fontSize: 13 }}>{stats.deal}</div></div>
            </div>
            <div className="two" style={{ marginTop: 16, gridTemplateColumns: "1fr auto", alignItems: "end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="tprice">Target price</label>
                <input id="tprice" type="number" placeholder={`e.g. ${Math.round(stats.lo * 1.02)}`} value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <button className="btn pri" style={{ width: "auto", height: 44 }} onClick={() => setAlertOpen(true)}>
                Set price alert <span className="pa-beta" style={{ marginLeft: 6 }}>Beta</span>
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <ShareLink notify={notify} />
              <button className="pill" onClick={() => nav("/tool/price/alerts")}>My alerts →</button>
            </div>
          </div>
        </div>
      )}
      {!stats && <div className="empty rise d2">Paste a product link to see the price chart, min/max analytics and buy verdict.</div>}
      {alertOpen && stats && (
        <Suspense fallback={null}>
          <SetPriceAlert
            product={{
              id: tracked, name: `${platform || "Product"} · ${tracked}`, image: null, url: tracked,
              currentPrice: stats.cur, currency: "INR", originalPrice: stats.hi,
            }}
            signedIn={false}
            manageBaseUrl={typeof window !== "undefined" ? `${window.location.origin}/tool/price/alerts` : undefined}
            onClose={() => setAlertOpen(false)}
            onCreated={() => notify("Price alert set. Check your email/WhatsApp when it triggers.")}
          />
        </Suspense>
      )}
    </div>
  );
}
