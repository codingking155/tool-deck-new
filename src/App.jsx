import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component } from "react";
import ToolIcon from "./components/ToolIcon.jsx";
import { Search, Sun, Moon, ArrowLeft, ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { PrivacyBadge, BetaBadge } from "./components/ui.jsx";
import { readRecent, pushRecent, clearRecent } from "./lib/recentTools.js";
import { TOOLS, tint, BETA_HINT } from "./toolsMeta.js";
import { useRoute, useNow, useReducedMotion, useDocumentMeta, readParams, useSwipe } from "./hooks/index.js";
import { Toast, FaqSection } from "./components/chrome.jsx";
import { Particles, CursorGlow } from "./components/Ambient.jsx";
import LocalClock from "./components/LocalClock.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import BengaluruFooter from "./components/BengaluruFooter.jsx";
import CornerWebs from "./components/CornerWebs.jsx";
import OverscrollSpider from "./components/OverscrollSpider.jsx";
import CrawlingSpiders from "./components/CrawlingSpiders.jsx";
import Home from "./pages/Home.jsx";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./tools/css/v3.css";

/* Tools on the redesigned workspace UI: their content sits inside .v3tool, which scopes
   the V3 primitives (src/tools/css/v3.css) so the shell, Home and other tools are unchanged. */
const V3_TOOLS = new Set(["speed", "ssl", "utc", "ytdownloader", "ip", "image", "pdf", "prompt", "phone", "password", "breach", "price"]);

/* After a deploy, an open tab may ask for a chunk hash that no longer exists:
   reload once to pick up the new build instead of showing the error panel. */
function lazyRetry(load) {
  return lazy(() => load().then((m) => { try { sessionStorage.removeItem("toolDeck.chunkReload"); } catch { /* ignore */ } return m; }, (err) => {
    let tried = false;
    try { tried = sessionStorage.getItem("toolDeck.chunkReload") === "1"; sessionStorage.setItem("toolDeck.chunkReload", "1"); } catch { tried = true; }
    if (!tried) { window.location.reload(); return new Promise(() => {}); }
    throw err;
  }));
}

/* Each tool is its own chunk — the first paint ships only the shell + home. */
const UtcTool = lazyRetry(() => import("./tools/UtcTool.jsx"));
const PhoneTool = lazyRetry(() => import("./tools/PhoneTool.jsx"));
const ShopifyDetectorTool = lazyRetry(() => import("./tools/ShopifyDetectorTool.jsx"));
const YtDownloaderTool = lazyRetry(() => import("./tools/YtDownloaderTool.jsx"));
const SpeedTool = lazyRetry(() => import("./tools/SpeedTool.jsx"));
const IpTool = lazyRetry(() => import("./tools/IpTool.jsx"));
const PriceTool = lazyRetry(() => import("./tools/PriceTool.jsx"));
const JsonTool = lazyRetry(() => import("./tools/JsonTool.jsx"));
const SslTool = lazyRetry(() => import("./tools/SslTool.jsx"));
const PasswordTool = lazyRetry(() => import("./tools/PasswordTool.jsx"));
const PromptTool = lazyRetry(() => import("./tools/PromptTool.jsx"));
const ImageTool = lazyRetry(() => import("./tools/ImageTool.jsx"));
const PdfTool = lazyRetry(() => import("./tools/PdfTool.jsx"));
const BreachTool = lazyRetry(() => import("./tools/BreachTool.jsx"));
const MyAlerts = lazyRetry(() => import("./features/priceAlerts/MyAlerts.jsx"));

const TOOL_VIEWS = {
  utc: UtcTool, phone: PhoneTool, shopifydetector: ShopifyDetectorTool,
  speed: SpeedTool, ip: IpTool, price: PriceTool, json: JsonTool, ssl: SslTool, password: PasswordTool, prompt: PromptTool, image: ImageTool, pdf: PdfTool, breach: BreachTool, ytdownloader: YtDownloaderTool,
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
        <div className="note w" role="alert"><b>Something went wrong in this tool.</b> Your files and inputs never left this device. Reset the tool to start again.
          <details style={{ marginTop: 6 }}><summary>Technical detail</summary><code>{String(this.state.err?.message || this.state.err)}</code></details></div>
        <button className="btn gh" style={{ marginTop: 12 }} onClick={() => { window.history.replaceState(null, "", window.location.pathname); this.setState({ err: null }); }}>
          Reset this tool
        </button>
      </div>
    );
  }
}

/* Owns the 1 s tick so only the clocks re-render, not the whole app. */
function HeaderClocks() {
  const now = useNow(1000);
  return <LocalClock now={now} />;
}

/* Real links (middle-click, crawlable) that route in-app on a plain click. */
function Crumb({ href, nav, children }) {
  return <a href={href} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); nav(href); }}>{children}</a>;
}

function NotFound({ nav }) {
  return (
    <div className="panel notfound">
      <h1>Page not found</h1>
      <p>There's no tool at <code>{window.location.pathname}</code>. It may have been renamed or removed.</p>
      <button className="btn" onClick={() => nav("/")}>Browse all tools</button>
    </div>
  );
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
  const timer = useRef(null);
  const reduced = useReducedMotion();
  const notify = useCallback((m) => { setToast(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 2600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  /* Keyboard shortcuts: Cmd/Ctrl+K for search, Cmd/Ctrl+/ for theme */
  useEffect(() => {
    const f = (e) => {
      const isCmd = e.ctrlKey || e.metaKey;
      if (isCmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        /* on Home the big launcher is the search: focus it instead of opening the palette */
        const home = document.getElementById("home-search");
        if (home) { home.focus(); home.select(); return; }
        setCp((v) => !v); return;
      }
      if (isCmd && e.key === "/") { e.preventDefault(); setTheme((t) => (t === "dark" ? "light" : "dark")); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [nav]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode / storage full — theme still applies this session */ }
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#FBF7F1" : "#07090F");
  }, [theme]);

  const isAlertsPage = route === "/tool/price/alerts";
  const seg = route.startsWith("/tool/") ? route.slice(6) : null;
  const slash = seg ? seg.indexOf("/") : -1;
  const toolId = seg == null ? null : slash === -1 ? seg : seg.slice(0, slash);

  /* Swipe navigation: swipe left → next tool, swipe right → previous tool */
  useSwipe(useCallback((direction) => {
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
  }, [route, toolId, nav, notify]));
  /* anything after /tool/<id>/ is handed to the tool as `arg` */
  const toolArg = seg != null && slash !== -1 ? safeDecode(seg.slice(slash + 1)) : null;
  const tool = isAlertsPage ? null : TOOLS.find((t) => t.id === toolId);
  const ToolView = tool ? TOOL_VIEWS[tool.id] : null;
  const ti = tool ? TOOLS.indexOf(tool) : 0;
  const prevTool = TOOLS[(ti - 1 + TOOLS.length) % TOOLS.length], nextTool = TOOLS[(ti + 1) % TOOLS.length];

  const isHome = route === "/" || route === "/index.html" || route === "";
  const notFound = !tool && !isAlertsPage && !isHome;

  /* remember opened tools on this device (no account) for Home's "Jump back in" */
  const [recent, setRecent] = useState(() => readRecent(TOOLS.map((t) => t.id)));
  useEffect(() => { if (tool) setRecent(pushRecent(tool.id)); }, [tool]);

  useDocumentMeta(tool, notFound);

  return (
    <div className={`app ${theme === "light" ? "light" : ""}`}>
      <a href="#main" className="skiplink">Skip to content</a>
      <div className="aurora" aria-hidden="true" /><div className="gridbg" aria-hidden="true" />
      <Particles reduced={reduced} theme={theme} /><CursorGlow reduced={reduced} />
      <CornerWebs size={300} spider={true} zIndex={5} theme={theme} />
      <OverscrollSpider height={150} zIndex={4} theme={theme} />
      <CrawlingSpiders theme={theme} reduced={reduced} />
      <div className="shell">
        <header className="hdr">
          <a className="logo" href="/" onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
            e.preventDefault();
            /* coin-flip the mark, then go home */
            const mark = e.currentTarget.querySelector(".logomark");
            if (reduced || !mark) { nav("/"); return; }
            if (!mark.classList.contains("spin")) {
              mark.classList.add("spin");
              setTimeout(() => { mark.classList.remove("spin"); nav("/"); }, 700);
            }
          }} aria-label="ToolDeck — all tools">
            <span className="logomark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="26" height="26"><path className="bolt" d="M 27 6 L 13.5 27 L 22 27 L 17.5 42 L 33.5 20.5 L 24.5 20.5 Z" /><path className="boltline" d="M 27 6 L 13.5 27 L 22 27 L 19.7 34.6" fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
            </span>
            <span className="lname">ToolDeck <small>everyday utilities</small></span>
          </a>
          <div className="sp" />
          <HeaderClocks />
          <div className="hbtns">
            {!isHome && <button className="hbtn" onClick={() => setCp(true)} title="Search tools (Ctrl/Cmd+K)" aria-label="Search tools">
              <Search size={17} strokeWidth={2.2} aria-hidden="true" /><span className="hlabel">Search</span><kbd className="hlabel">Ctrl K</kbd>
            </button>}
            <button className="hbtn ibtn" onClick={toggleTheme} title="Toggle theme (Ctrl/Cmd+/)" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              <span className="themeic" key={theme}>{theme === "dark" ? <Sun size={18} strokeWidth={2.2} aria-hidden="true" /> : <Moon size={18} strokeWidth={2.2} aria-hidden="true" />}</span>
            </button>
          </div>
        </header>

        <main id="main">
          {isHome && <Home nav={nav} reduced={reduced} recent={recent} onClearRecent={() => { clearRecent(); setRecent([]); }} />}
          {notFound && <NotFound nav={nav} />}
          {isAlertsPage && (
            <div className="tpage">
              <nav className="crumb" aria-label="Breadcrumb">
                <Crumb href="/tool/price" nav={nav}>← Price tracker</Crumb><span aria-hidden="true">/</span><span className="cur" aria-current="page">My alerts</span>
              </nav>
              <ToolErrorBoundary resetKey={route}>
                <Suspense fallback={<ToolFallback />}>
                  <div className="v3tool"><MyAlerts manageToken={readParams().get("t") || undefined} signedIn={false} /></div>
                </Suspense>
              </ToolErrorBoundary>
            </div>
          )}
          {tool && (
            <div className="tpage" key={tool.id}>
              <nav className="crumb tcrumb" aria-label="Breadcrumb">
                <Crumb href="/" nav={nav}><ArrowLeft size={15} aria-hidden="true" />All tools</Crumb>
                <span className="sep" aria-hidden="true">/</span>
                <span className="cur" aria-current="page">{tool.cat}</span>
                <span className="nx">
                  <Crumb href={`/tool/${prevTool.id}`} nav={nav} aria-label={`Previous tool: ${prevTool.name}`} title={prevTool.name}><ChevronLeft size={16} aria-hidden="true" /></Crumb>
                  <Crumb href={`/tool/${nextTool.id}`} nav={nav} aria-label={`Next tool: ${nextTool.name}`} title={nextTool.name}><span>Next</span><ChevronRight size={16} aria-hidden="true" /></Crumb>
                </span>
              </nav>
              <div className="thead tv3"><div className="tic" style={{ background: tint(tool.c, "1f"), borderColor: tint(tool.c, "70"), "--cc": tool.c }}><ToolIcon tool={tool} size={26} /></div>
                <div className="tmain">
                  <h1>{tool.name}{tool.beta && <BetaBadge />}</h1>
                  <p>{tool.desc}</p>
                  <div className="badges"><PrivacyBadge where={tool.where} /></div>
                </div>
              </div>
              {tool.beta && <p className="betanote"><FlaskConical size={14} aria-hidden="true" />{BETA_HINT}</p>}
              <ToolErrorBoundary resetKey={route}>
                <Suspense fallback={<ToolFallback />}>
                  <div className={V3_TOOLS.has(tool.id) ? "v3tool" : undefined}><ToolView notify={notify} nav={nav} arg={toolArg} /></div>
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
      <SpeedInsights />
    </div>
  );
}
