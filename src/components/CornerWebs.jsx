import { useEffect, useMemo, useRef } from "react";

/**
 * CornerWebs — ambient cobwebs that peek in from the four corners.
 *
 * Behaviour:
 *   • Invisible at rest (scrollY = 0) so the hero stays clean.
 *   • Fades in after ~30px of scroll, peaks around 150–380px, fades out by ~750px.
 *   • Bottom pair mirrors the same curve, measured from the end of the document.
 *   • The spider lowers itself on its silk, sways, and climbs back on its own
 *     (paused while the webs are faded out).
 *   • Takes the app theme via `theme` ("dark" | "light"); a `.dark` or
 *     `[data-theme="dark"]` ancestor still works as a fallback.
 *
 * Drop it once inside your root layout, after <body>'s main content.
 */

const SPOKES = 8;
const RINGS = 6;
const R = 100; // viewBox units

function buildWeb() {
  const angles = Array.from(
    { length: SPOKES },
    (_, i) => (Math.PI / 2) * (i / (SPOKES - 1))
  );

  const radials = angles.map(
    (a) => `M0 0 L${(Math.cos(a) * R).toFixed(2)} ${(Math.sin(a) * R).toFixed(2)}`
  );

  const rings = [];
  for (let r = 1; r <= RINGS; r++) {
    const rad = R * Math.pow(r / RINGS, 0.9) * 0.97;
    const sag = rad * 0.79; // pulls each span toward the corner — the "catenary" that reads as silk
    let d = "";
    for (let i = 0; i < SPOKES - 1; i++) {
      const a1 = angles[i];
      const a2 = angles[i + 1];
      const am = (a1 + a2) / 2;
      const x1 = (Math.cos(a1) * rad).toFixed(2);
      const y1 = (Math.sin(a1) * rad).toFixed(2);
      const x2 = (Math.cos(a2) * rad).toFixed(2);
      const y2 = (Math.sin(a2) * rad).toFixed(2);
      const cx = (Math.cos(am) * sag).toFixed(2);
      const cy = (Math.sin(am) * sag).toFixed(2);
      if (i === 0) d += `M${x1} ${y1}`;
      d += ` Q${cx} ${cy} ${x2} ${y2}`;
    }
    rings.push(d);
  }
  return { radials, rings };
}

/** 0 → 1 → 0 envelope: fade in, hold, fade out. */
function envelope(d) {
  if (d < 30 || d > 750) return 0;
  if (d < 150) return (d - 30) / 120;
  if (d <= 380) return 1;
  return 1 - (d - 380) / 370;
}

export default function CornerWebs({
  size = 300,
  spider = true,
  zIndex = 5,
  theme,
}) {
  const layer = useRef(null);
  const { radials, rings } = useMemo(buildWeb, []);

  useEffect(() => {
    const el = layer.current;
    if (!el) return;

    let frame = 0;
    let lastY = -1, lastFromEnd = -1;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      const fromEnd =
        document.documentElement.scrollHeight - (y + window.innerHeight);
      
      // Only update CSS if values actually changed (avoid forced reflow)
      const topVal = envelope(y);
      const botVal = envelope(fromEnd);
      if (Math.abs(topVal - lastY) > 0.01) {
        el.style.setProperty("--w-top", topVal.toFixed(3));
        /* the spider only animates while its web is actually on screen */
        el.classList.toggle("cw-on", topVal > 0);
        lastY = topVal;
      }
      if (Math.abs(botVal - lastFromEnd) > 0.01) {
        el.style.setProperty("--w-bot", botVal.toFixed(3));
        lastFromEnd = botVal;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const Web = () => (
    <svg viewBox={`0 0 ${R} ${R}`} className="cw-web" fill="none" aria-hidden="true">
      <g
        stroke="currentColor"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      >
        {radials.map((d, i) => (
          <path key={`r${i}`} d={d} strokeWidth={0.9} opacity={0.85} />
        ))}
        {rings.map((d, i) => (
          <path key={`c${i}`} d={d} strokeWidth={0.7} opacity={0.6} />
        ))}
      </g>
    </svg>
  );

  return (
    <div
      ref={layer}
      className={`cw-layer${theme === "dark" ? " cw-dark" : ""}`}
      aria-hidden="true"
      style={{ "--cw-size": `${size}px`, zIndex }}
    >
      <div className="cw cw-tl">
        <Web />
      </div>
      <div className="cw cw-tr">
        <Web />
        {spider && (
          <svg className="cw-spider" viewBox="0 0 40 120" fill="none">
            {/* sway pivots on the silk's anchor; silk stretches exactly as far as the body drops */}
            <g className="cw-sway">
              <line
                className="cw-silk"
                x1="20" y1="0" x2="20" y2="62"
                stroke="currentColor"
                strokeWidth="0.8"
                opacity="0.7"
              />
              <g className="cw-drop">
                <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <g className="cw-legs cw-legs-l">
                    <path d="M18 74 C10 70 7 76 4 84" />
                    <path d="M18 78 C9 78 5 84 3 92" />
                    <path d="M18 82 C10 86 8 92 6 99" />
                    <path d="M18 86 C11 92 11 97 10 103" />
                  </g>
                  <g className="cw-legs cw-legs-r">
                    <path d="M22 74 C30 70 33 76 36 84" />
                    <path d="M22 78 C31 78 35 84 37 92" />
                    <path d="M22 82 C30 86 32 92 34 99" />
                    <path d="M22 86 C29 92 29 97 30 103" />
                  </g>
                </g>
                <ellipse cx="20" cy="72" rx="4.5" ry="4" fill="currentColor" />
                <ellipse cx="20" cy="84" rx="7" ry="9" fill="currentColor" />
              </g>
            </g>
          </svg>
        )}
      </div>
      <div className="cw cw-bl">
        <Web />
      </div>
      <div className="cw cw-br">
        <Web />
      </div>

      <style>{`
        .cw-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          --w-top: 0;
          --w-bot: 0;
          --cw-ink: rgba(15, 23, 42, 0.42);
        }
        .cw-layer.cw-dark,
        .dark .cw-layer,
        [data-theme="dark"] .cw-layer {
          --cw-ink: rgba(226, 232, 240, 0.5);
        }
        .cw {
          position: absolute;
          width: clamp(120px, 24vw, var(--cw-size));
          aspect-ratio: 1;
          color: var(--cw-ink);
          will-change: opacity, transform;
          transition: opacity 220ms linear;
        }
        .cw .cw-web { width: 100%; height: 100%; display: block; }

        .cw-tl, .cw-tr { top: 0; opacity: var(--w-top); }
        .cw-bl, .cw-br { bottom: 0; opacity: var(--w-bot); }
        .cw-tl, .cw-bl { left: 0; }
        .cw-tr, .cw-br { right: 0; }

        /* each box grows from its own corner; only the drawing inside is mirrored,
           so the boxes stay on screen (mirroring the box itself about its corner
           flipped it outside the viewport) */
        .cw-tl { transform-origin: 0 0;       transform: scale(calc(0.9 + 0.1 * var(--w-top))); }
        .cw-tr { transform-origin: 100% 0;    transform: scale(calc(0.9 + 0.1 * var(--w-top))); }
        .cw-bl { transform-origin: 0 100%;    transform: scale(calc(0.9 + 0.1 * var(--w-bot))); }
        .cw-br { transform-origin: 100% 100%; transform: scale(calc(0.9 + 0.1 * var(--w-bot))); }
        .cw-tr .cw-web { transform: scaleX(-1); }
        .cw-bl .cw-web { transform: scaleY(-1); }
        .cw-br .cw-web { transform: scale(-1); }

        .cw-spider {
          position: absolute;
          top: 0;
          right: 34%;
          width: clamp(26px, 13%, 40px);
          height: auto;
          display: block;
          transform: translateY(calc(-14% + 14% * var(--w-top)));
          transition: transform 320ms cubic-bezier(.22,.61,.36,1);
          overflow: visible;
        }

        /* ── autonomous motion: one 16s cycle — rest, lower on the silk, recoil,
           hang, climb back in steps. Silk scaleY = 1 + drop/62 so its end always
           meets the body (both share keyframe stops and easing). ── */
        .cw-sway, .cw-silk, .cw-drop, .cw-legs { transform-box: view-box; }
        .cw-sway {
          transform-origin: 20px 0;
          animation: cw-sway 3.8s ease-in-out infinite alternate;
        }
        .cw-silk {
          transform-origin: 20px 0;
          animation: cw-silk 16s ease-in-out infinite;
        }
        .cw-drop { animation: cw-drop 16s ease-in-out infinite; }
        .cw-legs { animation: cw-legs 16s linear infinite; }
        .cw-legs-l { --leg: 1;  transform-origin: 18px 80px; }
        .cw-legs-r { --leg: -1; transform-origin: 22px 80px; }
        .cw-layer:not(.cw-on) .cw-spider,
        .cw-layer:not(.cw-on) .cw-spider * { animation-play-state: paused; }

        @keyframes cw-drop {
          0%, 10%   { transform: translateY(0); }
          24%       { transform: translateY(93px); }
          27%       { transform: translateY(80px); }
          30%       { transform: translateY(88px); }
          33%, 55%  { transform: translateY(85px); }
          60%, 63%  { transform: translateY(64px); }
          68%, 71%  { transform: translateY(42px); }
          76%, 79%  { transform: translateY(19px); }
          86%, 100% { transform: translateY(0); }
        }
        @keyframes cw-silk {
          0%, 10%   { transform: scaleY(1); }
          24%       { transform: scaleY(2.5); }
          27%       { transform: scaleY(2.29); }
          30%       { transform: scaleY(2.419); }
          33%, 55%  { transform: scaleY(2.371); }
          60%, 63%  { transform: scaleY(2.032); }
          68%, 71%  { transform: scaleY(1.677); }
          76%, 79%  { transform: scaleY(1.306); }
          86%, 100% { transform: scaleY(1); }
        }
        @keyframes cw-sway {
          from { transform: rotate(-4deg); }
          to   { transform: rotate(4deg); }
        }
        /* legs mostly still; a twitch while hanging, a scramble while climbing */
        @keyframes cw-legs {
          0%, 38%, 44%, 55%, 86%, 100% { transform: rotate(0deg); }
          40% { transform: rotate(calc(var(--leg) * 6deg)); }
          42% { transform: rotate(calc(var(--leg) * -3deg)); }
          58%, 66%, 74%, 82% { transform: rotate(calc(var(--leg) * 8deg)); }
          62%, 70%, 78%      { transform: rotate(calc(var(--leg) * -6deg)); }
        }

        @media (max-width: 640px) {
          .cw-bl, .cw-br { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cw, .cw-spider { transition: none; }
          .cw-sway, .cw-silk, .cw-drop, .cw-legs { animation: none; }
          .cw-tl, .cw-tr, .cw-bl, .cw-br { transform: none; }
        }
      `}</style>
    </div>
  );
}
