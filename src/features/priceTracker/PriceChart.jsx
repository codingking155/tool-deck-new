import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Price history as a step line: a price holds until the next real reading, so
 * nothing between readings is interpolated. Out-of-stock readings (price null)
 * break the line. The tooltip/crosshair snaps to real readings only.
 *
 * Drawn in measured pixel space (not a stretched viewBox) so text never distorts.
 */
export default function PriceChart({ observations, start, end, fmtPrice, fmtWhen, sourceLabel, lowest, highest }) {
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);   // index into `points`
  const H = 230, padL = 8, padR = 74, padT = 18, padB = 26;

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    const t0 = new Date(start).getTime(), t1 = Math.max(new Date(end).getTime(), t0 + 1);
    // the reading in force at the window start (may predate it) + readings inside it
    const series = [];
    for (const o of observations) {
      const t = new Date(o.observedAt).getTime();
      if (t <= t0) { series.length = 0; series.push({ ...o, t, carried: t < t0 }); }
      else if (t <= t1) series.push({ ...o, t, carried: false });
    }
    const priced = series.filter((o) => o.price != null);
    if (!priced.length) return null;
    let lo = Math.min(...priced.map((o) => o.price)), hi = Math.max(...priced.map((o) => o.price));
    const pad = hi === lo ? Math.max(1, hi * 0.05) : (hi - lo) * 0.12;
    lo = Math.max(0, lo - pad); hi += pad;
    // a single reading is a point in time, not a span: centre it, draw no line
    const single = priced.length === 1 && series.length === 1;
    const x = single ? () => padL + (w - padL - padR) / 2 : (t) => padL + ((Math.max(t0, t) - t0) / (t1 - t0)) * (w - padL - padR);
    const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);

    let d = "", pen = false;
    if (!single) series.forEach((o, i) => {
      const next = series[i + 1];
      const xe = x(next ? next.t : t1);
      if (o.price == null) { pen = false; return; }
      const xs = x(o.t), ys = y(o.price);
      d += pen ? `V${ys.toFixed(1)}` : `M${xs.toFixed(1)},${ys.toFixed(1)}`;
      d += `H${xe.toFixed(1)}`;
      pen = true;
    });

    const points = series.filter((o) => !o.carried).map((o) => ({ ...o, x: x(o.t), y: o.price == null ? null : y(o.price) }));
    const span = t1 - t0, DAY = 86_400_000;
    const tickFmt = span <= 2 * DAY ? { hour: "2-digit", minute: "2-digit" } : span > 300 * DAY ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" };
    const xTicks = single
      ? [{ x: x(), label: new Date(priced[0].observedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), mid: true }]
      : [0, 1 / 3, 2 / 3, 1].map((f) => ({ x: padL + f * (w - padL - padR), label: new Date(t0 + f * span).toLocaleString(undefined, tickFmt) }))
          .filter((tk, i, arr) => i === 0 || tk.label !== arr[i - 1].label);   // no repeated labels on short spans
    // round tick values (1/2/5 × 10ⁿ) inside the padded range
    const raw = (hi - lo) / 3, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const yTicks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi && yTicks.length < 6; v += step) yTicks.push({ y: y(v), label: fmtPrice(v, true) });
    const at = (o) => o && o.price != null && { x: x(Math.max(o.t, t0)), y: y(o.price) };
    return {
      d, points, xTicks, yTicks, endX: x(t1), single,
      lo: lowest && at({ price: lowest.price, t: new Date(lowest.observedAt).getTime() }),
      hi: highest && highest.price !== lowest?.price && at({ price: highest.price, t: new Date(highest.observedAt).getTime() }),
      // "now" marker only when the latest reading itself has a price (not while out of stock)
      last: series[series.length - 1]?.price != null ? { y: y(series[series.length - 1].price) } : null,
    };
  }, [observations, start, end, w, fmtPrice, lowest, highest]);

  if (!model) return null;
  const { d, points, xTicks, yTicks } = model;
  const nearest = (clientX) => {
    const r = wrap.current.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.x - px) < Math.abs(points[best].x - px)) best = i; });
    return best;
  };
  const hp = hover != null ? points[hover] : null;
  const tipLeft = hp ? Math.min(Math.max(hp.x - 90, 0), w - 180) : 0;

  return (
    <div className="pt-chart" ref={wrap}>
      <svg width={w} height={H} role="img" tabIndex={0}
        aria-label={`Price history: ${points.length} real reading${points.length === 1 ? "" : "s"}. Use left and right arrow keys to step through them.`}
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => setHover(nearest(e.clientX))}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? points.length) - 1)); }
          if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1)); }
          if (e.key === "Escape") setHover(null);
        }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} className="pt-grid" />
            <text x={w - padR + 8} y={t.y} dominantBaseline="central" className="pt-axis">{t.label}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 7} textAnchor={t.mid ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} className="pt-axis">{t.label}</text>
        ))}
        <path d={d} className="pt-line" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {model.lo && !model.single && <circle cx={model.lo.x} cy={model.lo.y} r="4.5" className="pt-lo" />}
        {model.hi && <circle cx={model.hi.x} cy={model.hi.y} r="4.5" className="pt-hi" />}
        {model.last && !model.single && <circle cx={model.endX} cy={model.last.y} r="5" className="pt-now" />}
        {model.single && points[0]?.y != null && <circle cx={points[0].x} cy={points[0].y} r="6" className="pt-now" />}
        {hp && (
          <g pointerEvents="none">
            <line x1={hp.x} x2={hp.x} y1={padT - 6} y2={H - padB} className="pt-cross" />
            {hp.y != null && <circle cx={hp.x} cy={hp.y} r="5" className="pt-dot" />}
          </g>
        )}
      </svg>
      {hp && (
        <div className="pt-tip" style={{ left: tipLeft }} role="status">
          <b>{hp.price != null ? fmtPrice(hp.price) : "Unavailable"}</b>
          <span>{fmtWhen(hp.observedAt)}</span>
          <span className="pt-tip-src">{hp.price == null ? hp.availability || "Out of stock" : sourceLabel(hp.source)}</span>
        </div>
      )}
    </div>
  );
}
