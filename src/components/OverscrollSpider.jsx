import { useEffect, useRef } from "react";

/**
 * OverscrollSpider — a spider hiding in the rubber-band gap.
 *
 * The strips sit just OUTSIDE the viewport (top: -H and bottom: -H on
 * position: fixed). At rest they're invisible. When the user rubber-band
 * overscrolls (macOS trackpad / iOS touch), the whole compositor layer
 * shifts, dragging the hidden strip into view — spider revealed.
 *
 * Also paints html's background to match the theme so the gap itself
 * never flashes the wrong color in light mode.
 *
 * Drop once in your root layout. Rename to .jsx / strip types if needed.
 */

export default function OverscrollSpider({ height = 150, zIndex = 4 }) {
  const rootRef = useRef(null);

  // Keep the overscroll gap color in sync with the theme so the strip
  // blends in. Watches class/data-theme changes on <html>.
  useEffect(() => {
    const html = document.documentElement;
    const paint = () => {
      const dark =
        html.classList.contains("dark") ||
        html.getAttribute("data-theme") === "dark";
      html.style.backgroundColor = dark ? "#0d1220" : "#faf6f2";
      rootRef.current?.classList.toggle("osp-dark", dark);
    };
    paint();
    const mo = new MutationObserver(paint);
    mo.observe(html, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  const Spider = ({ flip = false }) => (
    <svg
      viewBox="0 0 60 130"
      className="osp-spider"
      style={flip ? { transform: "scaleY(-1)" } : undefined}
      aria-hidden="true"
    >
      {/* silk thread */}
      <path d="M30 0 V58" className="osp-line" strokeWidth="1" opacity="0.65" />
      {/* legs */}
      <g className="osp-line" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M26 76 C15 70 11 77 7 87" />
        <path d="M26 82 C13 82 8 90 5 100" />
        <path d="M26 88 C15 94 12 101 9 110" />
        <path d="M27 93 C18 101 18 107 16 115" />
        <path d="M34 76 C45 70 49 77 53 87" />
        <path d="M34 82 C47 82 52 90 55 100" />
        <path d="M34 88 C45 94 48 101 51 110" />
        <path d="M33 93 C42 101 42 107 44 115" />
      </g>
      {/* body */}
      <ellipse cx="30" cy="74" rx="6.5" ry="6" className="osp-body" />
      <ellipse cx="30" cy="90" rx="10" ry="13" className="osp-body" />
      {/* eyes */}
      <circle cx="26.5" cy="73" r="1.9" className="osp-eye" />
      <circle cx="33.5" cy="73" r="1.9" className="osp-eye" />
    </svg>
  );

  const CornerWeb = () => (
    <svg viewBox="0 0 100 100" className="osp-web" aria-hidden="true">
      <g className="osp-line" fill="none" strokeLinecap="round">
        {[0, 15, 32, 51, 70, 90].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <path
              key={deg}
              d={`M0 0 L${(Math.cos(a) * 100).toFixed(1)} ${(Math.sin(a) * 100).toFixed(1)}`}
              strokeWidth="0.9"
              opacity="0.8"
            />
          );
        })}
        {[26, 46, 66, 86].map((rad) => {
          const angles = [0, 15, 32, 51, 70, 90].map((d) => (d * Math.PI) / 180);
          let d = "";
          for (let i = 0; i < angles.length - 1; i++) {
            const a1 = angles[i], a2 = angles[i + 1], am = (a1 + a2) / 2;
            const sag = rad * 0.8;
            if (i === 0) d += `M${(Math.cos(a1) * rad).toFixed(1)} ${(Math.sin(a1) * rad).toFixed(1)}`;
            d += ` Q${(Math.cos(am) * sag).toFixed(1)} ${(Math.sin(am) * sag).toFixed(1)} ${(Math.cos(a2) * rad).toFixed(1)} ${(Math.sin(a2) * rad).toFixed(1)}`;
          }
          return <path key={rad} d={d} strokeWidth="0.7" opacity="0.55" />;
        })}
      </g>
    </svg>
  );

  return (
    <div ref={rootRef} aria-hidden="true">
      <div className="osp-strip osp-top" style={{ top: -height, height, zIndex }}>
        <CornerWeb />
        <Spider />
        <div className="osp-eyes-pair">
          <span className="osp-glow" />
          <span className="osp-glow" />
        </div>
      </div>
      <div className="osp-strip osp-bot" style={{ bottom: -height, height, zIndex }}>
        <CornerWeb />
        <Spider flip />
      </div>

      <style>{`
        .osp-strip {
          position: fixed;
          left: 0;
          right: 0;
          pointer-events: none;
          --osp-ink: rgba(30, 27, 24, 0.75);
          --osp-eye: #ffb02e;
          background: #faf6f2;
        }
        .osp-dark .osp-strip {
          --osp-ink: rgba(226, 232, 240, 0.85);
          --osp-eye: #7ef0c2;
          background: #0d1220;
        }
        .osp-bot { transform: scaleY(-1); }

        .osp-line  { stroke: var(--osp-ink); }
        .osp-body  { fill: var(--osp-ink); }
        .osp-eye   { fill: var(--osp-eye); }

        .osp-web {
          position: absolute;
          top: 0; left: 0;
          width: min(150px, 40%);
          aspect-ratio: 1;
        }
        .osp-spider {
          position: absolute;
          top: 0;
          left: 50%;
          width: 46px;
          margin-left: -23px;
          height: auto;
          animation: osp-bob 3.2s ease-in-out infinite;
        }
        .osp-spider .osp-eye {
          animation: osp-blink 4s steps(1) infinite;
          transform-origin: center;
          transform-box: fill-box;
        }

        /* extra pair of glowing eyes lurking in the far right shadow */
        .osp-eyes-pair {
          position: absolute;
          right: 8%;
          bottom: 22%;
          display: flex;
          gap: 9px;
        }
        .osp-glow {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--osp-eye);
          animation: osp-blink 5.4s steps(1) infinite 1.2s;
        }

        @keyframes osp-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(7px); }
        }
        @keyframes osp-blink {
          0%, 91%, 100% { transform: scaleY(1); opacity: 1; }
          92%, 96%      { transform: scaleY(0.08); opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          .osp-spider, .osp-eye, .osp-glow { animation: none; }
        }
      `}</style>
    </div>
  );
}
