import { useState, useEffect, useMemo, useRef } from "react";
import { ZONES, searchZones } from "../lib/timezones.js";
import { offsetLabel } from "../lib/time.js";

export default function ZonePicker({ value, onChange, allowNone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const results = useMemo(() => searchZones(q).slice(0, 50), [q]);
  const sel = ZONES.find((e) => e.zone === value);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="zwrap" ref={ref}>
      <button type="button" className="zbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(""); }}>
        <span>{sel ? sel.flag : "🌐"}</span>
        <span className="nm">{sel ? sel.label : allowNone ? "None (optional)" : "Select timezone"}</span>
        <span className="off">{value ? offsetLabel(value) : ""}</span>
      </button>
      {open && (
        <div className="zpop">
          <input autoFocus placeholder="Search country or city…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search timezones" />
          <div className="zlist" role="listbox">
            {allowNone && <button type="button" className="zitem" onClick={() => { onChange(""); setOpen(false); }}>🚫 <span>None</span></button>}
            {results.length === 0 && <div className="zempty">No match for “{q}”.</div>}
            {results.map((e) => (
              <button key={e.zone} type="button" className="zitem" role="option" aria-selected={e.zone === value}
                onClick={() => { onChange(e.zone); setOpen(false); }}>
                <span>{e.flag}</span><span>{e.label}</span><span className="zo">{offsetLabel(e.zone)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
