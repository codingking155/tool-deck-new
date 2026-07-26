import { useState, useEffect, useCallback } from "react";
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
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setRm(mq.matches);
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
    window.scrollTo({ top: 0 });
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
      : "Six fast, private browser tools: UTC wait schedules, phone → country, Shopify detector, speed test, IP & IPv6, price tracker. Nothing you type is stored.";
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

export function useCountUp(target, dur = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

/* ─── IP-based locale (falls back to the device timezone) ───────────────── */

export function useIpLocale() {
  const [st, setSt] = useState({ tz: USER_TZ, src: "device", city: "", region: "", country: "" });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await (await fetch("https://ipapi.co/json/")).json();
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
   3) Neither: renders a friendly placeholder instead of a fake number. */

const COUNTER_ENDPOINT = ""; // e.g. "https://your-worker.example.workers.dev/hit"
let visitCounted = false;

export function useVisitCount() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          let cur = 0;
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
        }
      } catch { /* leave placeholder */ }
    })();
    return () => { alive = false; };
  }, []);
  return count;
}
