import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component } from "react";
import { flushSync } from "react-dom";
import { Search, Sun, Moon, ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, FlaskConical } from "lucide-react";
import ToolIcon from "./components/ToolIcon.jsx";
import { TOOLS, BETA_HINT } from "./toolsMeta.js";
import { useRoute, useNow, useReducedMotion, useDocumentMeta, readParams, useSwipe } from "./hooks/index.js";
import { Toast, FaqSection } from "./components/chrome.jsx";
import { PrivacyBadge, BetaBadge, MOD_KEY } from "./components/ui.jsx";
import { readRecent, pushRecent } from "./lib/recentTools.js";
import LocalClock from "./components/LocalClock.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import BengaluruFooter from "./components/BengaluruFooter.jsx";
import CornerWebs from "./components/CornerWebs.jsx";
import OverscrollSpider from "./components/OverscrollSpider.jsx";
import CrawlingSpiders from "./components/CrawlingSpiders.jsx";
import Home from "./pages/Home.jsx";
import { SpeedInsights } from "@vercel/speed-insights/react";

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
const TOOL_IDS = TOOLS.map((t) => t.id);

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
      <div className="panel errpanel" role="alert">
        <h2>Something went wrong in this tool.</h2>
        <p>Your files and inputs never left this device. Resetting clears the settings in the address bar and starts the tool fresh.</p>
        <div className="actions">
          <button className="btn auto" onClick={() => { window.history.replaceState(null, "", window.location.pathname); this.setState({ err: null }); }}>
            <RotateCcw size={15} aria-hidden="true" />Reset this tool
          </button>
          <a className="btn gh" href="/">Browse all tools</a>
        </div>
        <details><summary>Technical detail</summary><code>{String(this.state.err?.message || this.state.err)}</code></details>
      </div>
    );
  }
}

/* Owns the 1 s tick so only the clock re-renders, not the whole app. */
function HeaderClock() {
  const now = useNow(1000);
  return <LocalClock now={now} />;
}

/* Header gains a hairline once the page scrolls — toggled on the element, no React state. */
function useScrolledClass(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const f = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => el.classList.toggle("scrolled", window.scrollY > 4)); };
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", f); };
  }, [ref]);
}

/* Real links (middle-click, crawlable) that route in-app on a plain click. */
function Crumb({ href, nav, children, ...rest }) {
  return <a href={href} {...rest} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); nav(href); }}>{children}</a>;
}

function NotFound({ nav }) {
  return (
    <div className="notfound">
      <h1>Page not found</h1>
      <p>There's no tool at <code>{window.location.pathname}</code>. It may have been renamed or removed.</p>
      <button className="btn pri" onClick={() => nav("/")}>Browse all tools</button>
    </div>
  );
}

/* Skeleton shaped like the common two-column workspace, so the swap-in doesn't jump. */
function ToolFallback() {
  return (
    <div aria-busy="true" aria-label="Loading tool">
      <div className="tskel" aria-hidden="true">
        <div className="skel" />
        <div className="skel" />
      </div>
    </div>
  );
}

function ToolShell({ tool, nav, notify, arg, route }) {
  const ToolView = TOOL_VIEWS[tool.id];
  const i = TOOLS.indexOf(tool);
  const prev = TOOLS[(i - 1 + TOOLS.length) % TOOLS.length];
  const next = TOOLS[(i + 1) % TOOLS.length];
  return (
    <div className="tpage" key={tool.id} style={{ "--tool-accent": tool.c }}>
      <nav className="crumb" aria-label="Breadcrumb">
        <Crumb href="/" nav={nav}><ArrowLeft size={15} aria-hidden="true" />All tools</Crumb>
        <span className="sep" aria-hidden="true">/</span>
        <span className="cur" aria-current="page">{tool.cat}</span>
        <span className="nx">
          <Crumb href={`/tool/${prev.id}`} nav={nav} aria-label={`Previous tool: ${prev.name}`} title={prev.name}><ChevronLeft size={16} aria-hidden="true" /></Crumb>
          <Crumb href={`/tool/${next.id}`} nav={nav} aria-label={`Next tool: ${next.name}`} title={next.name}><span>Next</span><ChevronRight size={16} aria-hidden="true" /></Crumb>
        </span>
      </nav>
      <header className="thead">
        <div className="tic" style={{ "--cc": tool.c }} aria-hidden="true"><ToolIcon tool={tool} size={24} /></div>
        <div className="tmain">
          <h1>{tool.name}{tool.beta && <BetaBadge />}</h1>
          <p>{tool.desc}</p>
          <div className="badges"><PrivacyBadge where={tool.where} /></div>
        </div>
      </header>
      {tool.beta && <p className="betanote"><FlaskConical size={14} aria-hidden="true" />{BETA_HINT}</p>}
      <ToolErrorBoundary resetKey={route}>
        <Suspense fallback={<ToolFallback />}>
          <ToolView notify={notify} nav={nav} arg={arg} />
        </Suspense>
      </ToolErrorBoundary>
      {tool.faqs && <FaqSection tool={tool} />}
    </div>
  );
}

export default function App() {
  const [route, rawNav] = useRoute();
  const [theme, setTheme] = useState(initialTheme);
  const [toast, setToast] = useState("");
  const [cp, setCp] = useState(false);
  const [recent, setRecent] = useState(() => readRecent(TOOL_IDS));
  const timer = useRef(null);
  const hdrRef = useRef(null);
  const reduced = useReducedMotion();
  const notify = useCallback((m) => { setToast(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 2600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useScrolledClass(hdrRef);

  /* Spatial continuity: when the browser supports View Transitions, the tool's icon
     glides from wherever it was clicked into the tool header. Plain nav otherwise. */
  const nav = useCallback((href) => {
    if (reduced || typeof document.startViewTransition !== "function" || !href.startsWith("/tool/")) { rawNav(href); return; }
    document.startViewTransition(() => flushSync(() => rawNav(href)));
  }, [rawNav, reduced]);

  /* Keyboard shortcuts: Cmd/Ctrl+K for search, Cmd/Ctrl+/ for theme */
  useEffect(() => {
    const f = (e) => {
      const isCmd = e.ctrlKey || e.metaKey;
      if (isCmd && e.key.toLowerCase() === "k") { e.preventDefault(); setCp((v) => !v); return; }
      if (isCmd && e.key === "/") { e.preventDefault(); setTheme((t) => (t === "dark" ? "light" : "dark")); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode / storage full — theme still applies this session */ }
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#F6F2EB" : "#0A0B0E");
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
        rawNav(`/tool/${TOOLS[nextIdx].id}`);
        notify(`Switched to ${TOOLS[nextIdx].name}`);
      }
    }
  }, [route, toolId, rawNav, notify]));
  /* anything after /tool/<id>/ is handed to the tool as `arg` */
  const toolArg = seg != null && slash !== -1 ? safeDecode(seg.slice(slash + 1)) : null;
  const tool = isAlertsPage ? null : TOOLS.find((t) => t.id === toolId);

  const isHome = route === "/" || route === "/index.html" || route === "";
  const notFound = !tool && !isAlertsPage && !isHome;

  /* remember opened tools on this device for the launcher's Recent group */
  useEffect(() => { if (tool) setRecent(pushRecent(tool.id)); }, [tool]);

  useDocumentMeta(tool, notFound);

  return (
    <div className={`app ${theme === "light" ? "light" : ""} ${isHome ? "is-home" : "is-tool"}`}>
      <a href="#main" className="skiplink">Skip to content</a>
      <div className="aurora" aria-hidden="true" /><div className="gridbg" aria-hidden="true" />
      {isHome && <CornerWebs size={260} spider={true} zIndex={5} theme={theme} />}
      <OverscrollSpider height={150} zIndex={4} theme={theme} />
      <CrawlingSpiders theme={theme} reduced={reduced} />
      <div className="shell">
        <header className="hdr" ref={hdrRef}>
          <div className="hdr-in">
            <a className="logo" href="/" onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
              e.preventDefault();
              /* coin-flip the mark, then go home */
              const mark = e.currentTarget.querySelector(".logomark");
              if (reduced || !mark || isHome) { rawNav("/"); return; }
              if (!mark.classList.contains("spin")) {
                mark.classList.add("spin");
                setTimeout(() => { mark.classList.remove("spin"); rawNav("/"); }, 380);
              }
            }} aria-label="ToolDeck — all tools">
              <span className="logomark" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path className="bolt" d="M 27 6 L 13.5 27 L 22 27 L 17.5 42 L 33.5 20.5 L 24.5 20.5 Z" /><path className="boltline" d="M 27 6 L 13.5 27 L 22 27 L 19.7 34.6" fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
              </span>
              <span className="lname"><b>ToolDeck</b><small>BLR · UTILITY OS</small></span>
            </a>
            <button type="button" className="launch" onClick={() => setCp(true)} aria-label="Search tools (Ctrl or Command K)" aria-keyshortcuts="Control+K Meta+K">
              <Search size={16} aria-hidden="true" /><span>Search tools…</span><kbd className="kbd" aria-hidden="true">{MOD_KEY}K</kbd>
            </button>
            <HeaderClock />
            <button className="hbtn ibtn" onClick={toggleTheme} title="Toggle theme (Ctrl/Cmd+/)" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              <span className="themeic" key={theme}>{theme === "dark" ? <Sun size={17} strokeWidth={2.1} aria-hidden="true" /> : <Moon size={17} strokeWidth={2.1} aria-hidden="true" />}</span>
            </button>
          </div>
        </header>

        <main id="main">
          {isHome && <Home nav={nav} reduced={reduced} recent={recent} openPalette={() => setCp(true)} />}
          {notFound && <NotFound nav={rawNav} />}
          {isAlertsPage && (
            <div className="tpage">
              <nav className="crumb" aria-label="Breadcrumb">
                <Crumb href="/tool/price" nav={rawNav}><ArrowLeft size={15} aria-hidden="true" />Price tracker</Crumb><span className="sep" aria-hidden="true">/</span><span className="cur" aria-current="page">My alerts</span>
              </nav>
              <ToolErrorBoundary resetKey={route}>
                <Suspense fallback={<ToolFallback />}>
                  <MyAlerts manageToken={readParams().get("t") || undefined} signedIn={false} />
                </Suspense>
              </ToolErrorBoundary>
            </div>
          )}
          {tool && <ToolShell tool={tool} nav={rawNav} notify={notify} arg={toolArg} route={route} />}
        </main>
      </div>
      <BengaluruFooter reduced={reduced} theme={theme} />
      <CommandPalette open={cp} onClose={() => setCp(false)} nav={nav} toggleTheme={toggleTheme} theme={theme} recent={recent} notify={notify} />
      <InstallPrompt />
      <Toast msg={toast} />
      <SpeedInsights />
    </div>
  );
}
