import { useState, useRef } from "react";
import { useVisitCount } from "../hooks/index.js";

/* ── daylight palette ─────────────────────────────────────────────────────
   Naturalistic city tones: concrete, sandstone and blue-tinted glass. The
   train keeps a saturated Purple Line livery because it's the one element
   that has to read against a pale sky — everything else stays muted.
   Night mode is untouched and still runs on the design tokens. */
const DAY_TOWERS = ["#CFD7DD", "#DFD7C8", "#B8C6D1", "#E3DCD1", "#C4CDD5", "#D7CFC2", "#AEBDC9", "#DBD3C5", "#C8D0D5"];
const DAY_TOWER_LINE = "rgba(72,84,96,.30)";

const TOWERS = [
  { x: 340, y: 170, w: 26, h: 90, spire: true },
  { x: 380, y: 196, w: 70, h: 64 },
  { x: 470, y: 150, w: 34, h: 110 },
  { x: 520, y: 182, w: 56, h: 78 },
  { x: 600, y: 132, w: 40, h: 128 },
  { x: 660, y: 168, w: 64, h: 92 },
  { x: 744, y: 146, w: 30, h: 114 },
  { x: 792, y: 188, w: 74, h: 72 },
  { x: 884, y: 160, w: 42, h: 100 },
];

/* one fighter: tricolour contrail, afterburner, delta-wing silhouette */
function Jet({ dx = 0, dy = 0, scale = 1 }) {
  return (
    <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
      {[-3.4, 0, 3.4].map((ty, i) => (
        <rect key={i} x="-250" y={ty - 1} width="248" height="2" rx="1" fill={`url(#ct${i})`} opacity=".85" />
      ))}
      <ellipse cx="-6" cy="0" rx="9" ry="3.4" fill="url(#burn)" style={{ animation: "burnerflicker .16s linear infinite" }} />
      <g fill="#334155" stroke="#0F172A" strokeWidth=".9" strokeLinejoin="round">
        <path d="M 2 -11 L 8 -11 L 13 -1.6 L 5 -1.6 Z" />
        <path d="M 16 -1.4 L 5 -15 L 15 -15 L 30 -2.4 Z" />
        <path d="M 16 1.4 L 5 15 L 15 15 L 30 2.4 Z" />
        <path d="M 0 -2.6 L 28 -3.4 Q 40 -3.4 47 0 Q 40 3.4 28 3.4 L 0 2.6 Z" />
      </g>
      <path d="M 30 -2.2 Q 35.5 -4.4 39.5 -1.4 L 30 -0.6 Z" fill="#93C5FD" stroke="#1E3A8A" strokeWidth=".7" />
    </g>
  );
}

export default function BengaluruFooter({ reduced, theme }) {
  const [flying, setFlying] = useState(false);
  const [lorry, setLorry] = useState(false);
  const [morphKey, setMorphKey] = useState(0);
  const tapRef = useRef(0);
  const visitors = useVisitCount();
  const day = theme === "light";

  /* Heart hover/click → two-ship flypast, left to right, constant speed.
     Reduced-motion users still get the message, just without the flight. */
  const fly = () => {
    if (flying) return;
    setFlying(true);
    setTimeout(() => setFlying(false), reduced ? 3200 : 5600);
  };

  /* Double-click (or double-tap) the moving vehicle to swap auto ⇄ lorry.
     Counting pointerdowns covers mouse and touch with one handler. */
  const tapVehicle = () => {
    const now = Date.now();
    if (now - tapRef.current < 450) {
      setLorry((v) => !v);
      setMorphKey((k) => k + 1);
      tapRef.current = 0;
    } else {
      tapRef.current = now;
    }
  };

  const bldgLine = day ? DAY_TOWER_LINE : "var(--line)";
  const railFill = day ? "#B4AEA4" : "var(--line)";
  const glass = day ? "rgba(176,205,224,.85)" : "rgba(253,230,138,.55)";

  return (
    <footer className="footer">
      <div className="skywrap">
        <svg className="sky" viewBox="0 0 1200 300" role="img" aria-label="Illustrated Bengaluru skyline with a metro train, an auto-rickshaw and the airport tower">
          <defs>
            <linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1">
              {day ? (
                <>
                  <stop offset="0%" stopColor="#74AEDC" stopOpacity=".72" />
                  <stop offset="34%" stopColor="#A6C7E0" stopOpacity=".55" />
                  <stop offset="62%" stopColor="#CBD9E3" stopOpacity=".45" />
                  <stop offset="84%" stopColor="#E4DAC8" stopOpacity=".48" />
                  <stop offset="100%" stopColor="#EFD3AC" stopOpacity=".45" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="rgba(255,138,42,0)" />
                  <stop offset="100%" stopColor="rgba(255,138,42,.07)" />
                </>
              )}
            </linearGradient>
            <radialGradient id="sunglow"><stop offset="0%" stopColor="rgba(253,205,150,.75)" /><stop offset="100%" stopColor="rgba(253,205,150,0)" /></radialGradient>
            <linearGradient id="trailg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--pri2)" stopOpacity="0" /><stop offset="100%" stopColor="var(--pri2)" stopOpacity=".8" />
            </linearGradient>
            <linearGradient id="trailday" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5B21B6" stopOpacity="0" /><stop offset="100%" stopColor="#5B21B6" stopOpacity=".4" />
            </linearGradient>
            <linearGradient id="beamg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#FDE68A" stopOpacity=".55" /><stop offset="100%" stopColor="#FDE68A" stopOpacity="0" />
            </linearGradient>
            {/* soft warm haze on the horizon */}
            <linearGradient id="hazeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E0B583" stopOpacity="0" /><stop offset="100%" stopColor="#E0B583" stopOpacity=".22" />
            </linearGradient>
            {/* jet contrail — saffron, white, green */}
            {["#FF9933", "#FFFFFF", "#138808"].map((c, i) => (
              <linearGradient key={c} id={`ct${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={c} stopOpacity="0" /><stop offset="100%" stopColor={c} stopOpacity=".9" />
              </linearGradient>
            ))}
            <radialGradient id="burn"><stop offset="0%" stopColor="#FFF1B8" /><stop offset="55%" stopColor="#FB923C" /><stop offset="100%" stopColor="rgba(249,115,22,0)" /></radialGradient>
          </defs>

          <rect width="1200" height="300" fill="url(#skyg)" />
          {day && <rect x="0" y="196" width="1200" height="104" fill="url(#hazeg)" />}

          {!day && [...Array(26)].map((_, i) => (
            <circle key={i} cx={(i * 137 + 60) % 1180} cy={18 + ((i * 53) % 90)} r={i % 4 === 0 ? 1.6 : 1}
              fill="var(--pri2)" opacity=".5" style={reduced ? {} : { animation: `winkwindow ${5 + (i % 5)}s ${i * 0.4}s infinite` }} />
          ))}

          {day && (
            <g>
              <circle cx="1090" cy="54" r="54" fill="url(#sunglow)" />
              <circle cx="1090" cy="54" r="19" fill="#FBD79B" />
              <path d="M 60 90 Q 90 74 122 88 Q 150 70 186 86 Q 205 96 178 100 L 78 100 Q 48 98 60 90 Z" fill="#FFFFFF" opacity=".82" />
              <path d="M 830 60 Q 862 42 900 56 Q 934 40 968 58 Q 990 68 960 72 L 852 72 Q 818 70 830 60 Z" fill="#FFFFFF" opacity=".72" />
              {!reduced && [[300, 66], [332, 78], [364, 60]].map(([bx, by], i) => (
                <path key={bx} d={`M ${bx} ${by} q 5 -4 9 0 q 4 -4 9 0`} fill="none" stroke="#5C6B7C" strokeWidth="1.5"
                  strokeLinecap="round" opacity=".5" style={{ animation: `birdfly ${17 + i * 3}s ${i * 1.4}s linear infinite` }} />
              ))}
            </g>
          )}

          {!reduced && <g opacity={day ? ".85" : ".22"} fill={day ? "#FFFFFF" : "var(--tx2)"}>
            <ellipse cx="240" cy="52" rx="52" ry="12" style={{ animation: "clouddrift 26s linear infinite alternate" }} />
            <ellipse cx="720" cy="36" rx="66" ry="13" style={{ animation: "clouddrift 34s linear infinite alternate-reverse" }} />
          </g>}

          {/* Vidhana Soudha inspired — sandstone with a weathered gold dome */}
          <g fill={day ? "#EDE4D3" : "var(--panel2)"} stroke={day ? "rgba(118,100,72,.42)" : "var(--line)"} strokeWidth="1">
            <rect x="80" y="188" width="220" height="72" rx="3" />
            <rect x="150" y="158" width="80" height="34" rx="3" />
            <path d="M 168 158 Q 190 128 212 158 Z" fill={day ? "#D2A85B" : "var(--pri-soft)"} stroke={day ? "rgba(120,90,40,.5)" : "var(--pri-line)"} />
            <circle cx="190" cy="136" r="5" fill={day ? "#8A6A32" : "var(--pri2)"} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={96 + i * 30} y="204" width="10" height="40" fill={day ? "#E2D8C5" : "var(--panel)"} />)}
          </g>

          {/* skyline — concrete, sandstone and glass */}
          {TOWERS.map((t, i) => (
            <g key={t.x} fill={day ? DAY_TOWERS[i % DAY_TOWERS.length] : "var(--panel2)"} stroke={bldgLine} strokeWidth="1">
              <rect x={t.x} y={t.y} width={t.w} height={t.h} />
              {t.spire && <path d={`M${t.x} ${t.y} L${t.x + t.w / 2} ${t.y - 22} L${t.x + t.w} ${t.y} Z`} fill={day ? "#B49277" : "var(--pri-soft)"} />}
            </g>
          ))}

          {/* windows — reflective and static in daylight, lit and winking at night */}
          {[...Array(30)].map((_, i) => (
            <rect key={i} x={384 + ((i * 37) % 530)} y={160 + ((i * 23) % 84)} width="5" height="7"
              fill={day ? "#7A8B9C" : "var(--pri2)"} opacity={day ? ".3" : ".3"}
              style={reduced || day ? {} : { animation: `winkwindow ${6 + (i % 6)}s ${i * 0.33}s infinite` }} />
          ))}

          {/* airport tower */}
          <g>
            <rect x="1000" y="168" width="10" height="92" fill={day ? "#E3DED4" : "var(--panel2)"} stroke={bldgLine} />
            <path d="M 986 168 L 1024 168 L 1016 142 L 994 142 Z" fill={day ? "#C3D3DE" : "var(--panel2)"} stroke={bldgLine} />
            {!reduced && <g style={{ transformOrigin: "1005px 138px", animation: "beacon 4s linear infinite" }}>
              <line x1="1005" y1="138" x2="1042" y2="130" stroke={day ? "#B4362F" : "var(--pri2)"} strokeWidth="2" opacity=".6" /></g>}
            <circle cx="1005" cy="138" r="3.5" fill={day ? "#B4362F" : "var(--pri2)"} />
          </g>

          {/* trees */}
          {[60, 320, 560, 700, 940, 1080, 1150].map((x, i) => (
            <g key={x}><rect x={x} y="242" width="5" height="18" fill={day ? "#7A5A3C" : "var(--line)"} />
              <circle cx={x + 2.5} cy="236" r={11 + (i % 3) * 2.5} fill={day ? "#7FA968" : "var(--teal-soft)"}
                stroke={day ? "#4A6B3E" : "var(--teal)"} strokeOpacity={day ? ".5" : ".4"} /></g>
          ))}

          {/* metro viaduct */}
          <rect x="0" y="264" width="1200" height="4" fill={railFill} />
          {[...Array(13)].map((_, i) => <rect key={i} x={i * 100 + 40} y="268" width="6" height="16" fill={railFill} />)}

          {/* metro train — Purple Line livery keeps it legible against a pale sky */}
          <g style={reduced ? {} : { animation: `traindrive ${day ? 13 : 8.5}s linear infinite` }}>
            {!reduced && (
              <rect x="-150" y="252" width="150" height="10" rx="5" fill={day ? "url(#trailday)" : "url(#trailg)"} opacity={day ? ".35" : ".6"} />
            )}
            {[0, 64].map((dx) => (
              <g key={dx}>
                <rect x={dx} y="250" width="60" height="14" rx="3" fill={day ? "#F7F8FA" : "var(--panel2)"}
                  stroke={day ? "#3F2E73" : "var(--pri-line)"} strokeWidth={day ? "1.3" : "1"} />
                <rect x={dx} y="250" width="60" height="3.4" rx="1.6" fill={day ? "#5B21B6" : "transparent"} />
                <rect x={dx + 4} y="255.5" width="52" height="4.5" rx="2.2" fill={day ? "#4C1D95" : "var(--pri2)"} opacity={day ? ".85" : ".95"} />
              </g>
            ))}
            <path d="M 128 264 L 128 250 L 176 250 Q 186 250.5 192 254 Q 200 259 204 263.2 Q 205 264 202 264 Z"
              fill={day ? "#F7F8FA" : "var(--panel2)"} stroke={day ? "#3F2E73" : "var(--pri-line)"} strokeWidth={day ? "1.3" : "1"} />
            <path d="M 128 250 L 176 250 Q 184 250.4 189 252.6 L 128 253.4 Z" fill={day ? "#5B21B6" : "transparent"} />
            <path d="M 178 256 Q 190 259.4 196 262 L 174 262 L 174 256 Z" fill={day ? "#4C1D95" : "var(--pri2)"} opacity={day ? ".8" : ".8"} />
            <rect x="132" y="255.5" width="42" height="4.5" rx="2.2" fill={day ? "#4C1D95" : "var(--pri2)"} opacity={day ? ".85" : ".95"} />
            <rect x="2" y="261.4" width="196" height="1.8" fill={day ? "#C98A34" : "var(--pri2)"} opacity={day ? ".85" : ".7"} />
            {day && <circle cx="200" cy="261" r="2" fill="#FBE6B4" stroke="#8A6A32" strokeWidth=".6" />}
            {!day && <path d="M 204 258 L 258 252 L 258 264 L 204 263 Z" fill="var(--pri2)" opacity=".14" />}
          </g>

          {/* road */}
          <rect x="0" y="288" width="1200" height="12" fill={day ? "#8F8B84" : "var(--panel)"} />
          {day && [...Array(20)].map((_, i) => <rect key={i} x={i * 62 + 10} y="293" width="26" height="1.6" fill="#E6E2D8" opacity=".7" />)}

          {/* street vehicle — double-click to swap auto ⇄ lorry */}
          <g
            onPointerDown={tapVehicle}
            style={{
              cursor: "pointer",
              ...(reduced
                ? { transform: "translateX(300px)" }
                : { animation: day ? "autodrive 24s linear infinite" : "autodrive-rev 30s linear infinite" }),
            }}
          >
            <title>{lorry ? "Double-click to turn the lorry back into an auto" : "Double-click to turn the auto into a lorry"}</title>
            <rect x="-6" y="266" width="66" height="36" fill="transparent" />

            {day && !reduced && (
              <g fill="#A9AFB8">
                <circle cx="-3" cy="289" r="3" style={{ animation: "exhaustpuff 1.15s linear infinite" }} />
                <circle cx="-3" cy="289" r="3" style={{ animation: "exhaustpuff 1.15s .55s linear infinite" }} />
              </g>
            )}
            {!day && <path d={lorry ? "M 52 282 L 100 277 L 100 293 L 52 291 Z" : "M 33 284 L 82 279 L 82 294 L 33 292 Z"} fill="url(#beamg)"
              style={reduced ? {} : { animation: "headlightflicker 3.4s linear infinite" }} />}

            <g key={morphKey} className={reduced ? "" : "vmorph"}>
              <g style={reduced || !day ? {} : { animation: `puttputt ${lorry ? ".52s" : ".38s"} ease-in-out infinite` }}>
                {lorry ? (
                  /* ── lorry ── */
                  <g>
                    <rect x="1" y="271" width="31" height="20" rx="1.5" fill="#3B6FB5" stroke="rgba(0,0,0,.45)" strokeWidth="1" />
                    <rect x="1" y="275.5" width="31" height="3" fill="#E8CE6A" opacity=".9" />
                    <rect x="1" y="283.5" width="31" height="3" fill="#D98040" opacity=".9" />
                    <rect x="1" y="271" width="31" height="2.4" fill="#6FAEC2" opacity=".85" />
                    <path d="M 32 291 L 32 277 L 45 277 Q 50 277.4 51.6 282.4 L 52.6 291 Z"
                      fill="#C0392B" stroke="rgba(0,0,0,.45)" strokeWidth="1" />
                    <path d="M 44.6 278.6 Q 47.8 279.2 49.4 283 L 50 285.2 L 41.4 285.2 L 41.4 278.6 Z" fill={glass} />
                    <circle cx="51.4" cy="288.4" r="1.8" fill={day ? "#FDE68A" : "#FEF3C7"} />
                    {!day && <circle cx="1.8" cy="288" r="1.4" fill="#F87171" opacity=".9" />}
                    {[8.5, 21.5, 44].map((cx) => (
                      <g key={cx}>
                        <circle cx={cx} cy="294.6" r="4.6" fill="#1B1F27" stroke={day ? "#5A6068" : "var(--line)"} strokeWidth="1" />
                        <circle cx={cx} cy="294.6" r="1.6" fill={day ? "#C6CBD1" : "var(--tx2)"} />
                      </g>
                    ))}
                  </g>
                ) : (
                  /* ── auto-rickshaw ── */
                  <g>
                    <path d="M 1 294 L 1 285 Q 1 279 7 278 L 23 278 Q 30 279 32.6 286 L 33.6 294 Z"
                      fill="#F0B429" stroke="rgba(0,0,0,.45)" strokeWidth="1" />
                    <path d="M 1 284 Q 1 278.6 7 278 L 23 278 Q 27.4 278.6 29.4 281.6 L 29.8 284 Z"
                      fill="#232A35" stroke="rgba(0,0,0,.45)" strokeWidth=".8" />
                    <path d="M 24.5 279.4 Q 28.6 280.4 30.6 284.8 L 31.4 288.6 L 26.2 288.6 L 25 279.6 Z" fill={glass} />
                    <circle cx="32.8" cy="285.4" r="1.7" fill={day ? "#FDE68A" : "#FEF3C7"} />
                    {!day && <circle cx="1.6" cy="288.5" r="1.4" fill="#F87171" opacity=".9" />}
                    {[7.5, 27.5].map((cx) => (
                      <g key={cx}>
                        <circle cx={cx} cy="294.6" r="4.4" fill="#1B1F27" stroke={day ? "#5A6068" : "var(--line)"} strokeWidth="1" />
                        <circle cx={cx} cy="294.6" r="1.5" fill={day ? "#C6CBD1" : "var(--tx2)"} />
                      </g>
                    ))}
                  </g>
                )}
              </g>
            </g>
          </g>

          {/* ── heart hover → two-ship flypast, constant speed, left to right ── */}
          {flying && (
            <text className="tagline" fontFamily="Space Grotesk, sans-serif" fontSize="17" fontWeight="700"
              fill={day ? "#1E3A5F" : "var(--pri2)"} textAnchor="middle">
              <tspan x="600" y="48">Built for India. Ready for the world. ✈</tspan>
            </text>
          )}
          {flying && !reduced && (
            <g className="jetfly">
              {/* lead ship, then wingman in low echelon */}
              <g transform="translate(0 92)"><Jet /></g>
              <g transform="translate(0 92)"><Jet dx={-58} dy={24} scale={0.86} /></g>
            </g>
          )}
        </svg>
      </div>

      <div className="madein">
        <p>Made in Bengaluru with
          <button className="heartbtn" onClick={fly} onMouseEnter={fly} onFocus={fly}
            aria-label="Show the Built for India flypast"
            style={{ animationPlayState: flying ? "paused" : "running", opacity: flying ? 0.35 : 1 }}>❤️</button>
          love!
        </p>
      </div>

      <div className="foot-links">
        {visitors != null
          ? <span style={{ color: "var(--pri2)", fontWeight: 600 }}>👥 {visitors.toLocaleString("en-IN")} all-time visitor{visitors === 1 ? "" : "s"}</span>
          : <span title="Works automatically in the Claude preview; on your own host, point COUNTER_ENDPOINT at a tiny counter API.">👥 visitor counter connects on deployment</span>}
        <div style={{ marginTop: 6 }}>Tip: double-click the auto on the road to swap it for a lorry · hover the heart for a flypast</div>
        <div style={{ marginTop: 6 }}>Privacy: nothing you type is stored · IP lookups are never logged by this page · the visitor counter stores only one shared number · Reduced-motion is respected everywhere.</div>
      </div>
    </footer>
  );
}
