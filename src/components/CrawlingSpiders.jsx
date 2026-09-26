import { useEffect, useRef } from "react";

/**
 * CrawlingSpiders — a few top-down spiders that wander across the screen.
 *
 * Behaviour:
 *   • Spiders enter from a random edge, wander (turning, pausing), then leave
 *     through an edge after a while; a new one arrives a few seconds later.
 *   • Legs walk in an alternating tetrapod gait whose cadence follows speed.
 *   • They scurry away from the mouse cursor; click / tap one to squish it.
 *   • One rAF loop drives every spider by writing transforms directly — no React
 *     re-render per frame. Nothing renders under prefers-reduced-motion.
 *
 * Sits below popovers, the command palette, dialogs and toasts (z-index 40).
 */

const SLOTS = 3;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const angleDiff = (a, b) => ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/* legs: hips on the cephalothorax, front pairs reach forward, rear pairs back */
const LEGS = [0, 1, 2, 3].flatMap((i) => [1, -1].map((s) => {
  const hx = 20 + [4.6, 3.2, 1.6, 0][i], hy = 20 + s * 1.6;
  const a = (s * [40, 75, 110, 145][i] * Math.PI) / 180;
  const k = a + (s * [-35, -15, 15, 35][i] * Math.PI) / 180;
  const kx = hx + 6.5 * Math.cos(a), ky = hy + 6.5 * Math.sin(a);
  const fx = kx + 7 * Math.cos(k), fy = ky + 7 * Math.sin(k);
  /* tetrapod gait: L1 R2 L3 R4 swing together, the other four in antiphase */
  const phase = (i + (s === 1 ? 0 : 1)) % 2 === 0 ? "a" : "b";
  return { key: `${i}${s}`, hx, hy, d: `M${hx} ${hy} L${kx.toFixed(2)} ${ky.toFixed(2)} L${fx.toFixed(2)} ${fy.toFixed(2)}`, phase };
}));

function SpiderSvg() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <g className="cs-ink-stroke" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {LEGS.map((l) => (
          <path key={l.key} d={l.d} className={`cs-leg cs-${l.phase}`} style={{ transformOrigin: `${l.hx}px ${l.hy}px` }} />
        ))}
      </g>
      <ellipse cx="14" cy="20" rx="7" ry="5.5" className="cs-ink" />
      <ellipse cx="23" cy="20" rx="4.2" ry="3.6" className="cs-ink" />
      <circle cx="26.4" cy="18.9" r="0.8" className="cs-eye" />
      <circle cx="26.4" cy="21.1" r="0.8" className="cs-eye" />
    </svg>
  );
}

export default function CrawlingSpiders({ theme, reduced = false, zIndex = 40 }) {
  const slots = useRef([]);

  useEffect(() => {
    if (reduced) return undefined;
    const W = () => window.innerWidth, H = () => window.innerHeight;
    const maxActive = () => (W() < 640 ? 1 : SLOTS);
    const cursor = { x: -1e4, y: -1e4, mouse: false };
    let raf = 0, last = 0;

    const bugs = slots.current.map((el, i) => ({
      el, active: false, respawnAt: performance.now() + 2500 + i * 4500,
    }));

    const spawn = (b, now) => {
      const w = W(), h = H(), edge = Math.floor(Math.random() * 4);
      const along = rand(0.15, 0.85);
      b.x = edge === 1 ? w + 30 : edge === 3 ? -30 : along * w;
      b.y = edge === 0 ? -30 : edge === 2 ? h + 30 : along * h;
      b.th = Math.atan2(h / 2 - b.y, w / 2 - b.x) + rand(-0.7, 0.7);
      b.tth = b.th;
      b.v = 0;
      b.walk = rand(38, 64);
      b.scale = rand(0.85, 1.25);
      b.state = "walk";
      b.entered = false;
      b.leaveAt = now + rand(14000, 26000);
      b.nextTurn = now + rand(900, 2200);
      b.pauseUntil = 0;
      b.gait = 0;
      b.active = true;
      b.el.classList.remove("squished", "still");
      b.el.style.display = "block";
    };

    const retire = (b, now, delay) => {
      b.active = false;
      b.el.style.display = "none";
      b.el.classList.remove("squished");
      b.respawnAt = now + delay;
    };

    const squish = (b) => {
      if (!b.active || b.state === "squish") return;
      b.state = "squish";
      b.v = 0;
      b.el.classList.add("squished");
      b.squishedAt = performance.now();
    };

    const handlers = bugs.map((b) => {
      const h = (e) => { e.preventDefault(); e.stopPropagation(); squish(b); };
      b.el.addEventListener("pointerdown", h);
      return h;
    });

    const onMove = (e) => {
      cursor.x = e.clientX; cursor.y = e.clientY; cursor.mouse = e.pointerType === "mouse";
    };
    const onLeave = () => { cursor.x = cursor.y = -1e4; };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    const step = (now) => {
      raf = requestAnimationFrame(step);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const w = W(), h = H();
      let activeCount = bugs.filter((b) => b.active).length;

      for (const b of bugs) {
        if (!b.active) {
          if (now >= b.respawnAt && activeCount < maxActive()) { spawn(b, now); activeCount++; }
          continue;
        }
        if (b.state === "squish") {
          if (now - b.squishedAt > 1600) retire(b, now, rand(5000, 11000));
          continue;
        }

        const inside = b.x > 24 && b.x < w - 24 && b.y > 24 && b.y < h - 24;
        if (inside) b.entered = true;

        /* scurry away from a nearby mouse cursor */
        const dx = b.x - cursor.x, dy = b.y - cursor.y, dist = Math.hypot(dx, dy);
        if (cursor.mouse && dist < 120) { b.state = "flee"; b.tth = Math.atan2(dy, dx); }
        else if (b.state === "flee" && dist > 190) { b.state = "walk"; b.nextTurn = now + rand(400, 1200); }

        if (b.state !== "flee") {
          if (now > b.leaveAt) b.state = "leave";
          if (b.state === "leave") {
            /* head for the nearest edge */
            const opts = [[b.x, Math.PI], [w - b.x, 0], [b.y, -Math.PI / 2], [h - b.y, Math.PI / 2]];
            b.tth = opts.sort((p, q) => p[0] - q[0])[0][1];
          } else if (b.state === "pause") {
            if (now > b.pauseUntil) { b.state = "walk"; b.nextTurn = now + rand(600, 1800); }
          } else if (now > b.nextTurn) {
            b.tth = b.th + rand(-1.2, 1.2);
            b.nextTurn = now + rand(800, 2600);
            if (Math.random() < 0.22) { b.state = "pause"; b.pauseUntil = now + rand(600, 2200); }
          }
          /* come in off the edge, then stay on screen until it's time to leave */
          const m = 56;
          if (b.state !== "leave" && (b.x < m || b.x > w - m || b.y < m || b.y > h - m)) {
            const home = Math.atan2(h / 2 - b.y, w / 2 - b.x);
            if (Math.abs(angleDiff(b.th, home)) > 1.2) b.tth = home + rand(-0.5, 0.5);
          }
        }

        const run = b.state === "flee";
        const vTarget = b.state === "pause" ? 0 : run ? 190 : b.state === "leave" ? 85 : b.walk;
        b.v += (vTarget - b.v) * Math.min(1, dt * (run ? 9 : 5));
        b.th += angleDiff(b.th, b.tth) * Math.min(1, dt * (run ? 9 : 3.2));
        b.x += Math.cos(b.th) * b.v * dt;
        b.y += Math.sin(b.th) * b.v * dt;

        if (b.entered && (b.x < -50 || b.x > w + 50 || b.y < -50 || b.y > h + 50)) {
          retire(b, now, rand(3000, 9000));
          continue;
        }

        /* leg cadence follows speed; only touch the DOM when the bucket changes */
        const gait = b.v < 6 ? 0 : Math.max(0.06, Math.min(0.28, 8 / b.v));
        const bucket = Math.round(gait * 50);
        if (bucket !== b.gait) {
          b.gait = bucket;
          b.el.classList.toggle("still", gait === 0);
          if (gait) b.el.style.setProperty("--gait", `${gait.toFixed(2)}s`);
        }
        b.el.style.transform = `translate3d(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px,0) rotate(${b.th.toFixed(3)}rad) scale(${b.scale.toFixed(2)})`;
      }
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      bugs.forEach((b, i) => b.el.removeEventListener("pointerdown", handlers[i]));
    };
  }, [reduced]);

  if (reduced) return null;

  return (
    <div className={`cs-layer${theme === "dark" ? " cs-dark" : ""}`} aria-hidden="true" style={{ zIndex }}>
      {Array.from({ length: SLOTS }, (_, i) => (
        <div key={i} className="cs-spider" ref={(el) => { slots.current[i] = el; }}>
          <SpiderSvg />
        </div>
      ))}

      <style>{`
        .cs-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          --cs-ink: rgba(36, 26, 46, 0.82);
          --cs-eye: #ffb02e;
        }
        .cs-layer.cs-dark {
          --cs-ink: rgba(226, 232, 240, 0.78);
          --cs-eye: #7ef0c2;
        }
        .cs-spider {
          display: none;
          position: absolute;
          left: -20px;
          top: -20px;
          width: 40px;
          height: 40px;
          pointer-events: auto;
          cursor: pointer;
          will-change: transform;
          touch-action: none;
          --gait: 0.14s;
        }
        .cs-spider svg { width: 100%; height: 100%; display: block; overflow: visible; }
        .cs-ink { fill: var(--cs-ink); }
        .cs-ink-stroke { stroke: var(--cs-ink); }
        .cs-eye { fill: var(--cs-eye); }

        .cs-leg {
          transform-box: view-box;
          animation: cs-step var(--gait) ease-in-out infinite alternate;
        }
        .cs-b { animation-delay: calc(var(--gait) * -1); }
        .cs-spider.still .cs-leg { animation-play-state: paused; }
        @keyframes cs-step {
          from { transform: rotate(-13deg); }
          to   { transform: rotate(13deg); }
        }

        /* squished: legs splay flat, body spreads, then fades away */
        .cs-spider.squished { pointer-events: none; cursor: default; }
        .cs-spider.squished .cs-leg { animation: none; transform: rotate(0deg); }
        .cs-spider.squished svg { animation: cs-squish 1.5s ease-out forwards; }
        @keyframes cs-squish {
          0%   { transform: scale(1);    opacity: 1; }
          12%  { transform: scale(1.3, 1.45); opacity: 1; }
          60%  { transform: scale(1.3, 1.45); opacity: 0.85; }
          100% { transform: scale(1.3, 1.45); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
