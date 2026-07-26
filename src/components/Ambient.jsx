import { useEffect, useRef } from "react";

/* particle canvas — pauses on reduced motion / hidden tab */
export function Particles({ reduced, theme }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reduced) return;
    const palette = theme === "light"
      ? ["rgba(249,115,22,.55)", "rgba(14,165,233,.5)", "rgba(139,92,246,.45)", "rgba(16,185,129,.5)", "rgba(236,72,153,.45)"]
      : ["rgba(255,170,90,.35)", "rgba(77,214,200,.3)", "rgba(150,120,255,.28)"];
    const cv = ref.current, ctx = cv.getContext("2d", { alpha: true, desynchronized: true });
    let W, H, raf, running = true;
    const mouse = { x: -9999, y: -9999 };
    let lastMove = 0;
    const resize = () => { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; };
    resize();
    const N = window.innerWidth < 700 ? 16 : 32; // Reduced particle count
    const ps = Array.from({ length: N }, (_, i) => ({
      x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15, r: 0.6 + Math.random() * 1.2,
      c: palette[i % palette.length],
    }));
    const onMove = (e) => { 
      const now = performance.now();
      if (now - lastMove > 50) { // Throttle mouse tracking
        mouse.x = e.clientX; mouse.y = e.clientY; 
        lastMove = now;
      }
    };
    const onVis = () => { running = !document.hidden; if (running) raf = requestAnimationFrame(tick); };
    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 12000) { p.x += dx * 0.008; p.y += dy * 0.008; } // Reduced attraction
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fillStyle = p.c; ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced, theme]);
  if (reduced) return null;
  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}

export function CursorGlow({ reduced }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reduced || window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current;
    let lastX = -9999, lastY = -9999, rafId = null;
    const update = () => {
      rafId = null;
      el.style.left = lastX + "px";
      el.style.top = lastY + "px";
    };
    const f = (e) => { 
      lastX = e.clientX; 
      lastY = e.clientY;
      if (!rafId) rafId = requestAnimationFrame(update);
    };
    window.addEventListener("mousemove", f, { passive: true });
    return () => {
      window.removeEventListener("mousemove", f);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [reduced]);
  if (reduced) return null;
  return <div ref={ref} className="glow" aria-hidden="true" style={{ left: "50%", top: "-200px" }} />;
}

/* card tilt micro-interaction (writes CSS vars, no re-render) */
export function tiltHandlers(reduced) {
  if (reduced) return {};
  return {
    onMouseMove: (e) => {
      const el = e.currentTarget, r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(1000px) rotateX(${(0.5 - py) * 9}deg) rotateY(${(px - 0.5) * 11}deg) translateY(-4px) scale(1.015)`;
      const pct = (v) => `${(v * 100).toFixed(1)}%`;
      el.style.setProperty("--mx", pct(px)); el.style.setProperty("--my", pct(py));
      el.style.setProperty("--gx", pct(px)); el.style.setProperty("--gy", pct(py));
    },
    onMouseLeave: (e) => { e.currentTarget.style.transform = ""; },
  };
}
