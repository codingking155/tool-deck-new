import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component } from "react";
import { Search, Sun, Moon } from "lucide-react";
import { TOOLS, tint } from "./toolsMeta.js";
import { fmtUtc } from "./lib/time.js";
import { useRoute, useNow, useReducedMotion, useDocumentMeta, readParams, useSwipe } from "./hooks/index.js";
import { Toast, FaqSection } from "./components/chrome.jsx";
import { Particles, CursorGlow } from "./components/Ambient.jsx";
import LocalClock from "./components/LocalClock.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import BottomSheet from "./components/BottomSheet.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import BengaluruFooter from "./components/BengaluruFooter.jsx";
import CornerWebs from "./components/CornerWebs.jsx";
import OverscrollSpider from "./components/OverscrollSpider.jsx";
import CrawlingSpiders from "./components/CrawlingSpiders.jsx";
import Home from "./pages/Home.jsx";
const Analytics = lazy(() => import("./pages/Analytics.jsx"));

/* Each tool is its own chunk — the first paint ships only the shell + home. */
const UtcTool = lazy(() => import("./tools/UtcTool.jsx"));
const PhoneTool = lazy(() => import("./tools/PhoneTool.jsx"));
const ShopifyTool = lazy(() => import("./tools/ShopifyTool.jsx"));
const ShopifyDetectorTool = lazy(() => import("./tools/ShopifyDetectorTool.jsx"));
const SpeedTool = lazy(() => import("./tools/SpeedTool.jsx"));
const IpTool = lazy(() => import("./tools/IpTool.jsx"));
const PriceTool = lazy(() => import("./tools/PriceTool.jsx"));
const JsonTool = lazy(() => import("./tools/JsonTool.jsx"));
const SslTool = lazy(() => import("./tools/SslTool.jsx"));
const PasswordTool = lazy(() => import("./tools/PasswordTool.jsx"));
const PromptTool = lazy(() => import("./tools/PromptTool.jsx"));
const ImageTool = lazy(() => import("./tools/ImageTool.jsx"));
const PdfTool = lazy(() => import("./tools/PdfTool.jsx"));
const BreachTool = lazy(() => import("./tools/BreachTool.jsx"));
const MyAlerts = lazy(() => import("./features/priceAlerts/MyAlerts.jsx"));

const TOOL_VIEWS = {
  utc: UtcTool, phone: PhoneTool, shopify: ShopifyTool, shopifydetector: ShopifyDetectorTool,
  speed: SpeedTool, ip: IpTool, price: PriceTool, json: JsonTool, ssl: SslTool, password: PasswordTool, prompt: PromptTool, image: ImageTool, pdf: PdfTool, breach: BreachTool,
};

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

const THEME_KEY = "toolDeck.theme";
function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage unavailable — fall through to the OS preference */ }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/* One bad query-string value (e.g. ?tz=Nope) must not blank the whole app. */
class ToolErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="panel" style={{ padding: 22 }}>
        <div className="note w"><b>This tool hit an error · </b>{String(this.state.err?.message || this.state.err)}</div>
        <button className="btn gh" style={{ marginTop: 12 }} onClick={() => { window.history.replaceState(null, "", window.location.pathname); this.setState({ err: null }); }}>
          Reset this tool
        </button>
      </div>
    );
  }
}

function ToolFallback() {
  return (
    <div style={{ padding: "40px 20px" }}>
      <div className="grid2" aria-hidden="true">
        <div className="skel" style={{ height: 280, borderRadius: 18 }} />
        <div className="skel" style={{ height: 280, borderRadius: 18 }} />
      </div>
      <div className="skel" style={{ height: 120, borderRadius: 18, marginTop: 20 }} />
      <p style={{ textAlign: "center", color: "var(--tx3)", fontSize: "13px", marginTop: 16 }}>Loading tool...</p>
    </div>
  );
}

export default function App() {
  const [route, nav] = useRoute();
  const [theme, setTheme] = useState(initialTheme);
  const [toast, setToast] = useState("");
  const [cp, setCp] = useState(false);
  const [settingsSheet, setSettingsSheet] = useState(false);
  const timer = useRef(null);
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const notify = useCallback((m) => { setToast(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 2600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  /* Keyboard shortcuts: Cmd/Ctrl+K for search, Cmd/Ctrl+/ for theme, 1-7 to jump to tool */
  useEffect(() => {
    const f = (e) => {
      const isCmd = e.ctrlKey || e.metaKey;
      if (isCmd && e.key.toLowerCase() === "k") { e.preventDefault(); setCp((v) => !v); return; }
      if (isCmd && e.key === "/") { e.preventDefault(); setTheme((t) => (t === "dark" ? "light" : "dark")); return; }
      if (isCmd && e.key >= "1" && e.key <= "7") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < TOOLS.length) nav(`/tool/${TOOLS[idx].id}`);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [nav]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode / storage full — theme still applies this session */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#FBF7F1" : "#07090F");
  }, [theme]);

  const isAnalyticsPage = route === "/analytics";
  const isAlertsPage = route === "/tool/price/alerts";
  const seg = route.startsWith("/tool/") ? route.slice(6) : null;
  const slash = seg ? seg.indexOf("/") : -1;
  const toolId = seg == null ? null : slash === -1 ? seg : seg.slice(0, slash);

  /* Swipe navigation: swipe left → next tool, swipe right → previous tool */
  useSwipe((direction) => {
    if (route.startsWith("/tool/") && toolId) {
      const currentToolIndex = TOOLS.findIndex((t) => t.id === toolId);
      if (currentToolIndex !== -1) {
        const nextIdx = direction === "left"
          ? (currentToolIndex + 1) % TOOLS.length
          : (currentToolIndex - 1 + TOOLS.length) % TOOLS.length;
        nav(`/tool/${TOOLS[nextIdx].id}`);
        notify(`Switched to ${TOOLS[nextIdx].name}`);
      }
    }
  });
  /* prefix trick: /tool/shopify/<any-domain> auto-checks it, like a URL prefix */
  const toolArg = seg != null && slash !== -1 ? safeDecode(seg.slice(slash + 1)) : null;
  const tool = isAlertsPage ? null : TOOLS.find((t) => t.id === toolId);
  const ToolView = tool ? TOOL_VIEWS[tool.id] : null;

  useDocumentMeta(tool);

  return (
    <div className={`app ${theme === "light" ? "light" : ""}`}>
      <a href="#main" className="skiplink">Skip to content</a>
      <div className="aurora" aria-hidden="true" /><div className="gridbg" aria-hidden="true" />
      <Particles reduced={reduced} theme={theme} /><CursorGlow reduced={reduced} />
      <CornerWebs size={300} spider={true} zIndex={5} theme={theme} />
      <OverscrollSpider height={150} zIndex={4} theme={theme} />
      <CrawlingSpiders theme={theme} reduced={reduced} />
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
          <div className="uclock utcchip" title="Live UTC">{fmtUtc(now)} UTC</div>
          <div className="hbtns">
            <button className="hbtn" onClick={() => setCp(true)} title="Search tools (Ctrl/Cmd+K)" aria-label="Search tools">
              <Search size={17} strokeWidth={2.2} aria-hidden="true" /><span className="hlabel">Search</span><kbd className="hlabel">Ctrl K</kbd>
            </button>
            <button className="hbtn ibtn" onClick={toggleTheme} title="Toggle theme (Ctrl/Cmd+/)" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              <span className="themeic" key={theme}>{theme === "dark" ? <Sun size={18} strokeWidth={2.2} aria-hidden="true" /> : <Moon size={18} strokeWidth={2.2} aria-hidden="true" />}</span>
            </button>
          </div>
        </header>

        <main id="main">
          {!tool && !isAlertsPage && !isAnalyticsPage && <Home nav={nav} reduced={reduced} />}
          {isAnalyticsPage && (
            <Suspense fallback={<ToolFallback />}>
              <Analytics />
            </Suspense>
          )}
          {isAlertsPage && (
            <div className="tpage">
              <div className="crumb">
                <button onClick={() => nav("/tool/price")}>← Price tracker</button><span>/</span><span>My alerts</span>
              </div>
              <ToolErrorBoundary resetKey={route}>
                <Suspense fallback={<ToolFallback />}>
                  <MyAlerts manageToken={readParams().get("t") || undefined} signedIn={false} />
                </Suspense>
              </ToolErrorBoundary>
            </div>
          )}
          {tool && (
            <div className="tpage" key={tool.id}>
              <div className="crumb"><button onClick={() => nav("/")}>← All tools</button><span>/</span><span>{tool.name}</span></div>
              <div className="thead"><div className="tic" style={{ background: tint(tool.c, "1f"), borderColor: tint(tool.c, "70") }}>{tool.icon}</div>
                <div><h2>{tool.name}</h2><p>{tool.desc}</p></div></div>
              <ToolErrorBoundary resetKey={route}>
                <Suspense fallback={<ToolFallback />}>
                  <ToolView notify={notify} nav={nav} arg={toolArg} />
                </Suspense>
              </ToolErrorBoundary>
              {tool.faqs && <FaqSection tool={tool} />}
            </div>
          )}
        </main>
      </div>
      <BengaluruFooter reduced={reduced} theme={theme} />
      <CommandPalette open={cp} onClose={() => setCp(false)} nav={nav} toggleTheme={toggleTheme} />
      <InstallPrompt />
      <Toast msg={toast} />
    </div>
  );
}
