import { useState, useEffect, useMemo, useRef } from "react";
import { ZONES, searchZones, canonicalZone } from "../lib/timezones.js";
import { offsetLabel } from "../lib/time.js";

export default function ZonePicker({ value, onChange, allowNone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const ref = useRef(null);
  const results = useMemo(() => searchZones(q).slice(0, 50), [q]);
  const sel = ZONES.find((e) => e.zone === canonicalZone(value));
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="zwrap" ref={ref}>
      <button type="button" className="zbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(""); setAct(0); }}>
        <span>{sel ? sel.flag : "🌐"}</span>
        <span className="nm">{sel ? sel.label : allowNone ? "None (optional)" : "Select timezone"}</span>
        <span className="off">{value ? offsetLabel(value) : ""}</span>
      </button>
      {open && (
        <div className="zpop">
          <input autoFocus placeholder="Search country or city…" value={q} onChange={(e) => { setQ(e.target.value); setAct(0); }} aria-label="Search timezones"
            role="combobox" aria-expanded="true" aria-controls="zlist" aria-activedescendant={results[act] ? `zopt-${act}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && results[act]) { e.preventDefault(); onChange(results[act].zone); setOpen(false); }
            }} />
          <div className="zlist" role="listbox" id="zlist">
            {allowNone && <button type="button" className="zitem" onClick={() => { onChange(""); setOpen(false); }}>🚫 <span>None</span></button>}
            {results.length === 0 && <div className="zempty">No match for “{q}”.</div>}
            {results.map((e, i) => (
              <button key={e.zone} id={`zopt-${i}`} ref={i === act ? (n) => n?.scrollIntoView({ block: "nearest" }) : undefined} data-active={i === act} type="button" className="zitem" role="option" aria-selected={e.zone === value} tabIndex={-1}
                onClick={() => { onChange(e.zone); setOpen(false); }}>
                <span>{e.flag}</span><span className="zl"><span>{e.label}</span><span className="zz">{e.zone}</span></span><span className="zo">{offsetLabel(e.zone)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
