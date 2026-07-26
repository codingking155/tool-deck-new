import { useEffect, useMemo, useRef } from "react";

/**
 * CornerWebs — ambient cobwebs that peek in from the four corners.
 *
 * Behaviour:
 *   • Invisible at rest (scrollY = 0) so the hero stays clean.
 *   • Fades in after ~30px of scroll, peaks around 150–380px, fades out by ~750px.
 *   • Bottom pair mirrors the same curve, measured from the end of the document.
 *   • Reads light/dark from a `.dark` or `[data-theme="dark"]` ancestor.
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
    <svg viewBox={`0 0 ${R} ${R}`} fill="none" aria-hidden="true">
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
      className="cw-layer"
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
            <path
              d="M20 0 V62"
              stroke="currentColor"
              strokeWidth="0.8"
              opacity="0.7"
            />
            <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M18 74 C10 70 7 76 4 84" />
              <path d="M18 78 C9 78 5 84 3 92" />
              <path d="M18 82 C10 86 8 92 6 99" />
              <path d="M18 86 C11 92 11 97 10 103" />
              <path d="M22 74 C30 70 33 76 36 84" />
              <path d="M22 78 C31 78 35 84 37 92" />
              <path d="M22 82 C30 86 32 92 34 99" />
              <path d="M22 86 C29 92 29 97 30 103" />
            </g>
            <ellipse cx="20" cy="72" rx="4.5" ry="4" fill="currentColor" />
            <ellipse cx="20" cy="84" rx="7" ry="9" fill="currentColor" />
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
        .cw svg { width: 100%; height: 100%; display: block; }

        .cw-tl, .cw-tr { top: 0; opacity: var(--w-top); }
        .cw-bl, .cw-br { bottom: 0; opacity: var(--w-bot); }
        .cw-tl, .cw-bl { left: 0; }
        .cw-tr, .cw-br { right: 0; }

        .cw-tl { transform-origin: 0 0;       transform: scale(calc(0.9 + 0.1 * var(--w-top))); }
        .cw-tr { transform-origin: 100% 0;    transform: scaleX(-1) scale(calc(0.9 + 0.1 * var(--w-top))); }
        .cw-bl { transform-origin: 0 100%;    transform: scaleY(-1) scale(calc(0.9 + 0.1 * var(--w-bot))); }
        .cw-br { transform-origin: 100% 100%; transform: scale(-1) scale(calc(0.9 + 0.1 * var(--w-bot))); }

        .cw-spider {
          position: absolute;
          top: 0;
          left: 34%;
          width: 13%;
          height: auto;
          transform: scaleX(-1) translateY(calc(-14% + 14% * var(--w-top)));
          transition: transform 320ms cubic-bezier(.22,.61,.36,1);
        }

        @media (max-width: 640px) {
          .cw-bl, .cw-br { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cw, .cw-spider { transition: none; }
          .cw-tl, .cw-tr, .cw-bl, .cw-br { transform: none; }
        }
      `}</style>
    </div>
  );
}
