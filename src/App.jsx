import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { TOOLS, tint } from "./toolsMeta.js";
import { fmtUtc } from "./lib/time.js";
import { useRoute, useNow, useReducedMotion, useDocumentMeta, readParams } from "./hooks/index.js";
import { Toast, FaqSection } from "./components/chrome.jsx";
import { Particles, CursorGlow } from "./components/Ambient.jsx";
import LocalClock from "./components/LocalClock.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import BengaluruFooter from "./components/BengaluruFooter.jsx";
import CornerWebs from "./components/CornerWebs.jsx";
import OverscrollSpider from "./components/OverscrollSpider.jsx";
import Home from "./pages/Home.jsx";

/* Each tool is its own chunk — the first paint ships only the shell + home. */
const UtcTool = lazy(() => import("./tools/UtcTool.jsx"));
const PhoneTool = lazy(() => import("./tools/PhoneTool.jsx"));
const ShopifyTool = lazy(() => import("./tools/ShopifyTool.jsx"));
const SpeedTool = lazy(() => import("./tools/SpeedTool.jsx"));
const IpTool = lazy(() => import("./tools/IpTool.jsx"));
const PriceTool = lazy(() => import("./tools/PriceTool.jsx"));
const MyAlerts = lazy(() => import("./features/priceAlerts/MyAlerts.jsx"));

const TOOL_VIEWS = {
  utc: UtcTool, phone: PhoneTool, shopify: ShopifyTool,
  speed: SpeedTool, ip: IpTool, price: PriceTool,
};

function ToolFallback() {
  return (
    <div className="grid2" aria-hidden="true">
      <div className="skel" style={{ height: 320, borderRadius: 18 }} />
      <div className="skel" style={{ height: 320, borderRadius: 18 }} />
    </div>
  );
}

export default function App() {
  const [route, nav] = useRoute();
  const [theme, setTheme] = useState("dark");
  const [toast, setToast] = useState("");
  const [cp, setCp] = useState(false);
  const timer = useRef(null);
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const notify = useCallback((m) => { setToast(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 2600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const f = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCp((v) => !v); } };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  const isAlertsPage = route === "/tool/price/alerts";
  const seg = route.startsWith("/tool/") ? route.slice(6) : null;
  const slash = seg ? seg.indexOf("/") : -1;
  const toolId = seg == null ? null : slash === -1 ? seg : seg.slice(0, slash);
  /* prefix trick: /tool/shopify/<any-domain> auto-checks it, like a URL prefix */
  const toolArg = seg != null && slash !== -1 ? decodeURIComponent(seg.slice(slash + 1)) : null;
  const tool = isAlertsPage ? null : TOOLS.find((t) => t.id === toolId);
  const ToolView = tool ? TOOL_VIEWS[tool.id] : null;

  useDocumentMeta(tool);

  return (
    <div className={`app ${theme === "light" ? "light" : ""}`}>
      <a href="#main" className="skiplink">Skip to content</a>
      <div className="aurora" aria-hidden="true" /><div className="gridbg" aria-hidden="true" />
      <Particles reduced={reduced} theme={theme} /><CursorGlow reduced={reduced} />
      <CornerWebs size={300} spider={true} zIndex={5} />
      <OverscrollSpider height={150} zIndex={4} />
      <div className="shell">
        <header className="hdr rise">
          <button className="logo" onClick={(e) => {
            /* coin-flip the mark, then hard-refresh to the homepage */
            const mark = e.currentTarget.querySelector(".logomark");
            if (mark && !mark.classList.contains("spin")) {
              mark.classList.add("spin");
              if (reduced) { window.location.assign("/"); return; }
              setTimeout(() => window.location.assign("/"), 700);
            }
          }} aria-label="Reload and go to homepage">
            <span className="logomark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="26" height="26"><path className="bolt" d="M 27 6 L 13.5 27 L 22 27 L 17.5 42 L 33.5 20.5 L 24.5 20.5 Z" /><path className="boltline" d="M 27 6 L 13.5 27 L 22 27 L 19.7 34.6" fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
            </span>
            <span><h1>ToolDeck <small style={{ fontFamily: '"Raleway", sans-serif', fontWeight: 700, fontStyle: 'italic' }}>everyday utilities</small></h1></span>
          </button>
          <div className="sp" />
          <LocalClock now={now} />
          <div className="uclock" title="Live UTC" style={{ opacity: 0.75 }}>{fmtUtc(now)} UTC</div>
          <button className="hbtn" onClick={() => setCp(true)}>⌕ Search <kbd>Ctrl K</kbd></button>
          <button className="hbtn" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
        </header>

        <main id="main">
          {!tool && !isAlertsPage && <Home nav={nav} reduced={reduced} />}
          {isAlertsPage && (
            <div className="tpage">
              <div className="crumb">
                <button onClick={() => nav("/tool/price")}>← Price tracker</button><span>/</span><span>My alerts</span>
              </div>
              <Suspense fallback={<ToolFallback />}>
                <MyAlerts manageToken={readParams().get("t") || undefined} signedIn={false} />
              </Suspense>
            </div>
          )}
          {tool && (
            <div className="tpage" key={tool.id}>
              <div className="crumb"><button onClick={() => nav("/")}>← All tools</button><span>/</span><span>{tool.name}</span></div>
              <div className="thead"><div className="tic" style={{ background: tint(tool.c, "1f"), borderColor: tint(tool.c, "70") }}>{tool.icon}</div>
                <div><h2>{tool.name}</h2><p>{tool.desc}</p></div></div>
              <Suspense fallback={<ToolFallback />}>
                <ToolView notify={notify} nav={nav} arg={toolArg} />
              </Suspense>
              {tool.faqs && <FaqSection tool={tool} />}
            </div>
          )}
        </main>
      </div>
      <BengaluruFooter reduced={reduced} theme={theme} />
      <CommandPalette open={cp} onClose={() => setCp(false)} nav={nav} toggleTheme={toggleTheme} />
      <Toast msg={toast} />
    </div>
  );
}
