import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ArrowRight, ShieldCheck, Globe2, UserX, CornerDownLeft, SearchX } from "lucide-react";
import { TOOLS, CATEGORIES, WHERE_LABEL } from "../toolsMeta.js";
import { searchTools, highlightRuns } from "../lib/toolSearch.js";
import ToolIcon from "../components/ToolIcon.jsx";
import { PrivacyBadge, BetaBadge, EmptyState, MOD_KEY } from "../components/ui.jsx";

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
  film: <><rect x="30" y="9" width="52" height="34" rx="6" className="pv-ln" /><path d="M51 19v14l12-7z" className="pv-acc" />
    <rect x="30" y="48" width="52" height="4" rx="2" className="pv-fill" /><rect x="30" y="48" width="52" height="4" rx="2" className="pv-meter" /></>,
  pages: <><rect x="38" y="12" width="32" height="40" rx="4" className="pv-ln pv-dim pv-page2" /><rect x="44" y="7" width="32" height="40" rx="4" className="pv-ln pv-page" />
    <rect x="50" y="16" width="18" height="3" rx="1.5" className="pv-fill" /><rect x="50" y="23" width="20" height="3" rx="1.5" className="pv-fill" /><rect x="50" y="30" width="14" height="3" rx="1.5" className="pv-fill" /></>,
};

function Preview({ kind }) {
  const art = PV[kind];
  if (!art) return null;
  return <div className="preview" aria-hidden="true"><svg viewBox="0 0 112 58" width="112" height="58">{art}</svg></div>;
}

/* flagship + stable tools first, Beta last; registry order otherwise */
const ORDERED = [...TOOLS].sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0) || (a.beta ? 1 : 0) - (b.beta ? 1 : 0));
const ON_DEVICE = TOOLS.filter((t) => t.where === "device").length;
const COUNTS = Object.fromEntries(CATEGORIES.map((c) => [c, c === "All" ? TOOLS.length : TOOLS.filter((t) => t.cat === c).length]));
const plain = (e) => e.metaKey || e.ctrlKey || e.shiftKey || e.button;

function Name({ text, hl }) {
  if (!hl?.length) return text;
  return highlightRuns(text, hl).map((r, i) => (r.hit ? <mark key={i} className="hl">{r.text}</mark> : <span key={i}>{r.text}</span>));
}

/* Card → tool: name the clicked icon so the View Transition glides it into the tool header. */
function openTool(e, nav, id) {
  if (plain(e)) return;
  e.preventDefault();
  const ic = e.currentTarget.querySelector(".bic,.cic");
  if (ic) ic.style.viewTransitionName = "tool-ic";
  nav(`/tool/${id}`);
}

export default function Home({ nav, recent = [], openPalette }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [local, setLocal] = useState(false);
  const inputRef = useRef(null);
  const gridRef = useRef(null);

  /* "/" focuses the launcher from anywhere on Home (unless typing in a field) */
  useEffect(() => {
    const f = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      e.preventDefault(); inputRef.current?.focus();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const list = useMemo(() => searchTools(ORDERED, q).filter((r) => (cat === "All" || r.tool.cat === cat) && (!local || r.tool.where === "device")), [q, cat, local]);
  const recentTools = recent.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean).slice(0, 5);
  const filtered = q.trim() || cat !== "All" || local;
  const top = q.trim() && list[0]?.tool;

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-h">
        <p className="kicker"><span className="live" aria-hidden="true" />ToolDeck · {TOOLS.length} utilities · no sign-up</p>
        <h1 id="hero-h">Useful tools.<br /><span className="dim">Zero friction.</span></h1>
        <p className="lede">Time zones, networks, files, code and security — fast, focused utilities that open instantly. Most run entirely in your browser; nothing you type is stored.</p>
        <div className="finder">
          <div className="searchbar">
            <span className="ic" aria-hidden="true"><Search size={19} strokeWidth={2.2} /></span>
            <input ref={inputRef} type="search" placeholder="What do you need to do?" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search tools" aria-describedby="tool-count" enterKeyHint="go" autoComplete="off" spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && list.length) nav(`/tool/${list[0].tool.id}`);
                else if (e.key === "Escape") setQ("");
                else if (e.key === "ArrowDown" && list.length) { e.preventDefault(); gridRef.current?.querySelector(".bcard")?.focus(); }
              }} />
            <span className="sb-r" aria-hidden="true">
              {top ? <><CornerDownLeft size={13} />open <b>{top.name.split(" ")[0]}</b></> : <><kbd className="kbd">/</kbd>or<kbd className="kbd">{MOD_KEY}K</kbd></>}
            </span>
          </div>
          <div className="trust">
            <span className="t-dev"><ShieldCheck aria-hidden="true" />{ON_DEVICE} tools never upload</span>
            <span className="t-key"><UserX aria-hidden="true" />No account, no tracking cookies</span>
            <span className="t-net"><Globe2 aria-hidden="true" />Network use is always labelled</span>
          </div>
        </div>
      </section>

      {recentTools.length > 0 && !filtered && (
        <section className="shelf" aria-labelledby="recent-h">
          <div className="shelf-h"><h2 id="recent-h">Jump back in</h2></div>
          <div className="recent">
            {recentTools.map((t) => (
              <a key={t.id} href={`/tool/${t.id}`} className="rchip" style={{ "--cc": t.c }} onClick={(e) => openTool(e, nav, t.id)}>
                <span className="cic" aria-hidden="true"><ToolIcon tool={t} size={15} /></span>{t.name}
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="catbar">
        <div className="seg" role="group" aria-label="Filter tools by category">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}<span className="n" aria-hidden="true">{COUNTS[c]}</span></button>
          ))}
        </div>
        <button type="button" className="pill" aria-pressed={local} onClick={() => setLocal((v) => !v)} title={WHERE_LABEL.device[1]} aria-label="On-device only">
          <ShieldCheck size={14} aria-hidden="true" /><span className="pl">On-device only</span>
        </button>
        <span className="meta" id="tool-count" role="status">{list.length === TOOLS.length ? `${list.length} tools` : `${list.length} of ${TOOLS.length} tools`}</span>
      </div>

      <section className="bento" aria-label="Tools" ref={gridRef}
        onKeyDown={(e) => {
          /* arrow keys walk the grid like a launcher; Up from the first card returns to search */
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
          const cards = [...gridRef.current.querySelectorAll(".bcard")];
          const i = cards.indexOf(document.activeElement);
          if (i === -1) return;
          const cols = getComputedStyle(gridRef.current).gridTemplateColumns.split(" ").length;
          const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
          const j = i + step;
          e.preventDefault();
          if (j < 0) { inputRef.current?.focus(); return; }
          cards[Math.min(j, cards.length - 1)]?.focus();
        }}>
        {list.map(({ tool: t, hl }) => (
          <a key={t.id} href={`/tool/${t.id}`} className={`bcard ${t.big && !filtered ? "big" : ""}`} style={{ "--cc": t.c }}
            onClick={(e) => openTool(e, nav, t.id)}>
            <div className="btop">
              <div className="bic" aria-hidden="true"><ToolIcon tool={t} size={20} /></div>
              <Preview kind={t.pv} />
            </div>
            <h2><Name text={t.name} hl={hl} /></h2>
            <p>{t.desc}</p>
            <div className="bfoot">
              <PrivacyBadge where={t.where} />
              {t.beta && <BetaBadge />}
              <ArrowRight className="go" size={16} aria-hidden="true" />
            </div>
          </a>
        ))}
        {list.length === 0 && (
          <EmptyState icon={SearchX} title={`No tool matches “${q.trim() || cat}”`}
            actions={<>
              <button type="button" className="btn gh" onClick={() => { setQ(""); setCat("All"); setLocal(false); }}>Clear search and filters</button>
              <button type="button" className="btn qt" onClick={openPalette}>Open command search</button>
            </>}>
            Try a task instead of a name — “compress”, “timezone”, “certificate”.
          </EmptyState>
        )}
      </section>

      <section className="legend" aria-label="Where your data goes">
        <div><h3><PrivacyBadge where="device" /></h3><p>Processed entirely in your browser — files, passwords and text never leave this device.</p></div>
        <div><h3><PrivacyBadge where="tooldeck" /></h3><p>Sent to ToolDeck's own server only to perform the check, then discarded. Nothing is logged against you.</p></div>
        <div><h3><PrivacyBadge where="external" /></h3><p>Measures against a third-party network service, such as a speed-test edge or an IP lookup. Clearly labelled on every tool.</p></div>
      </section>
    </div>
  );
}
