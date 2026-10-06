import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { TOOLS, tint, ROTATE, CATEGORIES, WHERE_LABEL } from "../toolsMeta.js";
import { tiltHandlers } from "../components/Ambient.jsx";
import { useCountUp } from "../hooks/index.js";
import ToolIcon from "../components/ToolIcon.jsx";

/* Tiny animated illustration in each card's corner — one per tool, drawn in the
   tool's own hue (--cc) on the theme tokens so it reads in light and dark. */
const PV = {
  utc: <><rect className="pv-bar" x="10" y="12" width="44" height="7" rx="3.5" /><rect className="pv-bar" x="22" y="25" width="58" height="7" rx="3.5" style={{ animationDelay: ".5s" }} /><rect className="pv-bar" x="14" y="38" width="36" height="7" rx="3.5" style={{ animationDelay: "1s" }} /></>,
  globe: <><circle cx="56" cy="29" r="17" className="pv-ln" /><ellipse cx="56" cy="29" rx="7" ry="17" className="pv-ln pv-dim" /><path d="M39 29h34" className="pv-ln pv-dim" />
    <g className="pv-orbit"><circle cx="56" cy="6" r="3.2" className="pv-acc" /></g></>,
  bag: <><path d="M40 21h32l-3 27H43z" className="pv-ln" /><path d="M49 21v-3a7 7 0 0 1 14 0v3" className="pv-ln" />
    <path className="pv-draw" d="M50 35l5 5 8-9" pathLength="1" /><circle cx="84" cy="14" r="2.5" className="pv-acc pv-blink" /></>,
  lens: <><rect x="14" y="14" width="56" height="5" rx="2.5" className="pv-fill" /><rect x="14" y="26" width="72" height="5" rx="2.5" className="pv-fill" /><rect x="14" y="38" width="44" height="5" rx="2.5" className="pv-fill" />
    <g className="pv-sweep"><circle cx="30" cy="26" r="10" className="pv-ln pv-lens" /><path d="M37 33l7 7" className="pv-ln" /></g></>,
  gauge: <><path d="M30 46a26 26 0 0 1 52 0" className="pv-ln pv-dim" /><path d="M30 46a26 26 0 0 1 40-22" className="pv-ln pv-arc" pathLength="1" />
    <path d="M56 46V25" className="pv-needle" /><circle cx="56" cy="46" r="3" className="pv-acc" /></>,
  packets: <><circle cx="20" cy="29" r="6" className="pv-ln" /><circle cx="92" cy="29" r="6" className="pv-ln" /><path d="M27 29h58" className="pv-ln pv-dim" strokeDasharray="3 4" />
    <circle cx="28" cy="29" r="3" className="pv-acc pv-pkt" /><circle cx="28" cy="29" r="3" className="pv-acc pv-pkt" style={{ animationDelay: "-.9s", fill: "var(--teal)" }} /></>,
  chart: <><path d="M10 48h92" className="pv-ln pv-dim" /><polyline className="pv-draw" pathLength="1" points="10,42 26,32 40,37 56,20 72,27 88,11 102,16" /></>,
  braces: <><text x="22" y="38" className="pv-txt">{"{"}</text><text x="82" y="38" className="pv-txt">{"}"}</text>
    <rect className="pv-bar" x="38" y="18" width="30" height="5" rx="2.5" /><rect className="pv-bar" x="44" y="27" width="26" height="5" rx="2.5" style={{ animationDelay: ".4s" }} /><rect className="pv-bar" x="38" y="36" width="20" height="5" rx="2.5" style={{ animationDelay: ".8s" }} /></>,
  lock: <><path d="M48 27v-6a8 8 0 0 1 16 0v6" className="pv-ln pv-shackle" /><rect x="42" y="26" width="28" height="22" rx="4" className="pv-ln pv-body" />
    <circle cx="56" cy="35" r="2.6" className="pv-acc" /><path d="M56 37v5" className="pv-ln" /></>,
  dots: <><rect x="12" y="13" width="88" height="18" rx="6" className="pv-ln pv-dim" />
    {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={24 + i * 12} cy="22" r="3" className="pv-acc pv-type" style={{ animationDelay: `${i * 0.25}s` }} />)}
    <rect x="12" y="40" width="88" height="5" rx="2.5" className="pv-fill" /><rect x="12" y="40" width="88" height="5" rx="2.5" className="pv-meter" /></>,
  spark: <><path className="pv-star" d="M30 13l3.6 9.4L43 26l-9.4 3.6L30 39l-3.6-9.4L17 26l9.4-3.6z" />
    <rect className="pv-bar" x="54" y="17" width="44" height="5" rx="2.5" /><rect className="pv-bar" x="54" y="27" width="34" height="5" rx="2.5" style={{ animationDelay: ".4s" }} /><rect className="pv-bar" x="54" y="37" width="40" height="5" rx="2.5" style={{ animationDelay: ".8s" }} /></>,
  image: <><rect x="24" y="8" width="64" height="42" rx="6" className="pv-ln" /><circle cx="40" cy="21" r="4.5" className="pv-acc pv-blink" />
    <polyline className="pv-draw" pathLength="1" points="28,46 46,30 58,40 70,28 84,44" /></>,
  shield: <><path d="M56 7l18 7v12c0 12-8 20-18 25-10-5-18-13-18-25V14z" className="pv-ln" /><path className="pv-draw" d="M48 29l6 6 11-12" pathLength="1" /></>,
  pages: <><rect x="38" y="12" width="32" height="40" rx="4" className="pv-ln pv-dim pv-page2" /><rect x="44" y="7" width="32" height="40" rx="4" className="pv-ln pv-page" />
    <rect x="50" y="16" width="18" height="3" rx="1.5" className="pv-fill" /><rect x="50" y="23" width="20" height="3" rx="1.5" className="pv-fill" /><rect x="50" y="30" width="14" height="3" rx="1.5" className="pv-fill" /></>,
};

function Preview({ kind }) {
  const art = PV[kind];
  if (!art) return null;
  return <div className="preview" aria-hidden="true"><svg viewBox="0 0 112 58" width="112" height="58">{art}</svg></div>;
}

export default function Home({ nav, reduced }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [ri, setRi] = useState(0);
  useEffect(() => { const id = setInterval(() => setRi((i) => (i + 1) % ROTATE.length), 2600); return () => clearInterval(id); }, []);
  const c1 = useCountUp(TOOLS.length), c2 = useCountUp(240), c3 = useCountUp(TOOLS.filter((t) => t.where === "device").length);
  const list = TOOLS.filter((t) => (cat === "All" || t.cat === cat) && (t.name + t.desc).toLowerCase().includes(q.toLowerCase()));
  const th = tiltHandlers(reduced);
  return (
    <>
      <section className="hero rise">
        <h2>All the everyday tools you need, in one <em>intelligent workspace</em>.</h2>
        <div className="rotator" aria-live="polite"><span key={ri}>{ROTATE[ri]}</span></div>
        <div className="stats rise d3">
          <div className="stat"><b>{c1}</b><span>tools inside</span></div>
          <div className="stat"><b>{c2}+</b><span>dial codes indexed</span></div>
          <div className="stat"><b>{c3}</b><span>fully on-device</span></div>
        </div>
      </section>
      <div className="finder">
          <div className="searchbar rise d2">
            <span className="ic" aria-hidden="true"><Search size={18} strokeWidth={2.2} /></span>
            <input placeholder="Which tool do you need?" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search tools"
              onKeyDown={(e) => { if (e.key === "Enter" && list.length) nav(`/tool/${list[0].id}`); }} />
            <kbd>Ctrl K</kbd>
          </div>
      <div className="pillrow catrow" role="group" aria-label="Filter tools by category">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="pill" aria-pressed={cat === c} onClick={() => setCat(c)}
            style={cat === c ? { borderColor: "var(--pri2)", color: "var(--pri2)" } : undefined}>{c}</button>
        ))}
      </div>
      </div>
      <section className="bento">
        {list.map((t, i) => (
          <button key={t.id} className={`bcard rise ${t.big ? "big" : ""} d${Math.min(i + 1, 5)}`} {...th} onClick={() => nav(`/tool/${t.id}`)}
            style={{ borderTop: `2px solid ${tint(t.c, "66")}`, "--cc": t.c }}>
            <Preview kind={t.pv} />
            <div className="bic" aria-hidden="true" style={{ background: tint(t.c, "1f"), borderColor: tint(t.c, "70") }}><ToolIcon tool={t} /></div>
            <h3>{t.name}</h3>
            {t.where && <span className={`wbadge ${t.where}`} title={WHERE_LABEL[t.where][1]}>{WHERE_LABEL[t.where][0]}</span>}
            <p>{t.desc}</p>
            <span className="open" aria-hidden="true">Open tool <i>→</i></span>
          </button>
        ))}
        {list.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>No tool matches “{q}”.</div>}
      </section>
    </>
  );
}
