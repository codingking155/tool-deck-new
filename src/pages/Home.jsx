import { useState, useEffect } from "react";
import { TOOLS, tint, ROTATE } from "../toolsMeta.js";
import { tiltHandlers } from "../components/Ambient.jsx";
import { useCountUp } from "../hooks/index.js";

function Preview({ kind }) {
  if (kind === "utc") return <div className="preview pv-utc" aria-hidden="true">
    <i style={{ left: 10, top: 14, width: 46 }} /><i style={{ left: 22, top: 32, width: 60, animationDelay: ".5s" }} /><i style={{ left: 14, top: 50, width: 38, animationDelay: "1s" }} /></div>;
  if (kind === "globe") return <div className="preview pv-globe" aria-hidden="true"><div className="g"><div className="dot" style={{ left: 14, top: 14 }} /></div></div>;
  if (kind === "scan") return <div className="preview" aria-hidden="true"><div className="pv-scan" /></div>;
  if (kind === "gauge") return <div className="preview pv-gauge" aria-hidden="true"><div className="pv-needle" /></div>;
  if (kind === "packets") return <div className="preview" aria-hidden="true">
    <div className="pv-pk" style={{ animation: "slideblocks 1.8s linear infinite", top: 22, left: 8 }} />
    <div className="pv-pk" style={{ animation: "slideblocks 2.3s .4s linear infinite", top: 46, left: 8, background: "var(--teal)" }} /></div>;
  if (kind === "chart") return <div className="preview" aria-hidden="true">
    <svg width="120" height="74" viewBox="0 0 120 74"><polyline className="pv-chartline" points="6,58 26,44 42,50 60,30 78,38 96,18 114,24" /></svg></div>;
  return null;
}

export default function Home({ nav, reduced }) {
  const [q, setQ] = useState("");
  const [ri, setRi] = useState(0);
  useEffect(() => { const id = setInterval(() => setRi((i) => (i + 1) % ROTATE.length), 2600); return () => clearInterval(id); }, []);
  const c1 = useCountUp(6), c2 = useCountUp(240), c3 = useCountUp(100);
  const list = TOOLS.filter((t) => (t.name + t.desc).toLowerCase().includes(q.toLowerCase()));
  const th = tiltHandlers(reduced);
  return (
    <>
      <section className="hero rise">
        <h2>All the everyday tools you need, in one <em>intelligent workspace</em>.</h2>
        <div className="rotator" aria-live="polite"><span key={ri}>{ROTATE[ri]}</span></div>
        <div className="searchbar rise d2">
          <span className="ic" aria-hidden="true">⌕</span>
          <input placeholder="Which tool do you need?" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search tools"
            onKeyDown={(e) => { if (e.key === "Enter" && list.length) nav(`/tool/${list[0].id}`); }} />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="stats rise d3">
          <div className="stat"><b>{c1}</b><span>tools inside</span></div>
          <div className="stat"><b>{c2}+</b><span>dial codes indexed</span></div>
          <div className="stat"><b>{c3}%</b><span>runs in your browser</span></div>
        </div>
      </section>
      <section className="bento">
        {list.map((t, i) => (
          <button key={t.id} className={`bcard rise ${t.big ? "big" : ""} d${Math.min(i + 1, 5)}`} {...th} onClick={() => nav(`/tool/${t.id}`)}
            style={{ borderTop: `2px solid ${tint(t.c, "66")}`, "--cc": t.c }}>
            <Preview kind={t.pv} />
            <div className="bic" aria-hidden="true" style={{ background: tint(t.c, "1f"), borderColor: tint(t.c, "70") }}>{t.icon}</div>
            <h3>{t.name}</h3>
            <p>{t.desc}</p>
            <span className="open" style={{ color: t.c }}>Open tool <i>→</i></span>
          </button>
        ))}
        {list.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>No tool matches “{q}”.</div>}
      </section>
    </>
  );
}
