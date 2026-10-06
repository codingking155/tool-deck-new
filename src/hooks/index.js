import { useState, useEffect, useCallback, useRef } from "react";
import { USER_TZ, partsFormatter } from "../lib/time.js";
import { SITE, setMeta, setLink, setJsonLd } from "../lib/seo.js";

/* ─── clock ─────────────────────────────────────────────────────────────── */

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/* ─── accessibility ─────────────────────────────────────────────────────── */

export function useReducedMotion() {
  /* read synchronously so animation loops never start for users who opted out */
  const [rm, setRm] = useState(() => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const f = (e) => setRm(e.matches);
    mq.addEventListener ? mq.addEventListener("change", f) : mq.addListener(f);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", f) : mq.removeListener(f); };
  }, []);
  return rm;
}

/* ─── routing (History API, legacy #/tool/x links still resolve) ────────── */

function currentPath() {
  const h = window.location.hash.replace(/^#/, "");
  if (h && h.startsWith("/")) return h.split("?")[0];
  return window.location.pathname || "/";
}

export function useRoute() {
  const [route, setRoute] = useState(currentPath);
  useEffect(() => {
    const f = () => setRoute(currentPath());
    window.addEventListener("popstate", f);
    window.addEventListener("hashchange", f);
    return () => { window.removeEventListener("popstate", f); window.removeEventListener("hashchange", f); };
  }, []);
  const nav = useCallback((r) => {
    try { window.history.pushState(null, "", r); } catch { window.location.hash = r; }
    setRoute(r.split("?")[0]);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return [route, nav];
}

/* ─── shareable-result URL state (inputs live in the query string) ──────── */

export function readParams() { return new URLSearchParams(window.location.search); }

export function writeParams(obj) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  window.history.replaceState(null, "", u);
}

/* ─── per-tool document meta (title/OG/JSON-LD) ─────────────────────────── */

export function useDocumentMeta(tool) {
  useEffect(() => {
    const title = tool ? `${tool.name} · ToolDeck BLR` : "ToolDeck BLR — fast, private browser utilities";
    const desc = tool ? tool.blurb
      : "Fast, private everyday tools: UTC wait times, phone → country, Shopify detectors, speed test, IP & IPv6 leak checks, price tracker, PDF and image tools, JSON, passwords and breach checks. Nothing you type is stored.";
    const url = SITE + (tool ? `/tool/${tool.id}` : "/");
    document.title = title;
    setMeta("description", desc);
    setLink("canonical", url);
    setMeta("og:title", title, "property"); setMeta("og:description", desc, "property");
    setMeta("og:url", url, "property"); setMeta("og:type", "website", "property");
    setMeta("og:site_name", "ToolDeck BLR", "property"); setMeta("og:image", SITE + "/og.png", "property");
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title); setMeta("twitter:description", desc); setMeta("twitter:image", SITE + "/og.png");
    setJsonLd("ld-app", {
      "@context": "https://schema.org", "@type": "SoftwareApplication",
      name: tool ? tool.name : "ToolDeck BLR", applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web browser", url,
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    });
    setJsonLd("ld-faq", tool && tool.faqs && tool.faqs.length ? {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: tool.faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    } : null);
  }, [tool]);
}

/* ─── animated count-up ─────────────────────────────────────────────────── */

export function useCountUp(target, reduced = false, dur = 1400) {
  const [v, setV] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setV(target); return; }
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, dur]);
  return v;
}

/* ─── IP-based locale (falls back to the device timezone) ───────────────── */

export function useIpLocale() {
  const [st, setSt] = useState({ tz: USER_TZ, src: "device", city: "", region: "", country: "" });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        /* one lookup per browser session — ipapi.co's free tier is rate-limited */
        let j = null;
        try { j = JSON.parse(sessionStorage.getItem("toolDeck.ipLocale") || "null"); } catch { /* storage blocked */ }
        if (!j) {
          j = await (await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(6000) })).json();
          try { if (j && !j.error) sessionStorage.setItem("toolDeck.ipLocale", JSON.stringify({ timezone: j.timezone, city: j.city, region: j.region, country_name: j.country_name })); } catch { /* storage blocked */ }
        }
        if (!alive || !j || j.error) return;
        const next = {};
        if (j.timezone) { try { partsFormatter(j.timezone); next.tz = j.timezone; next.src = "ip"; } catch { /* invalid zone */ } }
        if (j.city) { next.city = j.city; next.region = j.region || ""; next.country = j.country_name || ""; }
        setSt((p) => ({ ...p, ...next }));
      } catch { /* sandbox or offline — device timezone stays */ }
    })();
    return () => { alive = false; };
  }, []);
  return st;
}

/* ─── all-time visitor counter ──────────────────────────────────────────── */
/* 1) Claude artifact preview: shared persistent storage (one shared number).
   2) Self-hosted: point COUNTER_ENDPOINT at a URL returning { count }.
   3) Browser localStorage fallback: persists per-browser/device.
   4) Neither: renders a friendly placeholder instead of a fake number. */

const COUNTER_ENDPOINT = ""; // e.g. "https://your-worker.example.workers.dev/hit"
let visitCounted = false;

export function useVisitCount() {
  // Initialize synchronously from localStorage so counter displays immediately (real-time)
  const [count, setCount] = useState(() => {
    if (typeof localStorage !== "undefined") {
      try { return parseInt(localStorage.getItem("site-visits-total"), 10) || 1; } catch { return 1; }
    }
    return 1;
  });
  
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          let cur = count;
          try { const r = await window.storage.get("site-visits-total", true); cur = r && r.value ? parseInt(r.value, 10) || 0 : 0; } catch { /* first visit */ }
          if (!visitCounted) {
            visitCounted = true; cur += 1;
            try { await window.storage.set("site-visits-total", String(cur), true); } catch { /* read-only */ }
          }
          if (alive) setCount(cur);
          return;
        }
        if (COUNTER_ENDPOINT) {
          const j = await (await fetch(COUNTER_ENDPOINT)).json();
          if (alive && j && typeof j.count === "number") setCount(j.count);
          return;
        }
        // Fallback to localStorage
        if (typeof localStorage !== "undefined") {
          let cur = count;
          if (!visitCounted) {
            visitCounted = true; cur += 1;
            try { localStorage.setItem("site-visits-total", String(cur)); } catch { /* private mode or full storage */ }
          }
          if (alive) setCount(cur);
          return;
        }
      } catch { /* keep current count */ }
    })();
    return () => { alive = false; };
  }, []);
  return count;
}

/* ─── swipe gesture detection (mobile tool navigation) ──────────────────── */

/* Horizontal swipes anywhere that isn't itself interactive or scrollable — a
   swipe on a signature pad, slider, editor or wide table must never navigate
   away and lose the user's work. */
const NO_SWIPE = "input, textarea, select, canvas, button, a, [contenteditable], [role=slider], [data-noswipe], pre, table, [role=dialog]";

function inScrollableX(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

export function useSwipe(onSwipe) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    let start = null;
    const onStart = (e) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || e.target.closest?.(NO_SWIPE) || inScrollableX(e.target) || window.getSelection?.()?.toString()) { start = null; return; }
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    };
    const onEnd = (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = start.x - (t?.clientX ?? start.x), dy = start.y - (t?.clientY ?? start.y);
      const quick = Date.now() - start.at <= 500;
      start = null;
      /* clearly horizontal: ≥80px across and at least 2× the vertical travel */
      if (quick && Math.abs(dx) >= 80 && Math.abs(dx) > 2 * Math.abs(dy)) cb.current?.(dx > 0 ? "left" : "right");
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);
}
