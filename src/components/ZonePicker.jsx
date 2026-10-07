import { useState, useEffect, useMemo, useRef, useId } from "react";
import { ZONES, searchZones, canonicalZone } from "../lib/timezones.js";
import { offsetLabel } from "../lib/time.js";
import { Globe2, Ban } from "lucide-react";

/** `id` names the trigger button; `labelledBy` is the id of the visible field label. */
export default function ZonePicker({ value, onChange, allowNone, id, labelledBy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const ref = useRef(null);
  const btn = useRef(null);
  const list = useRef(null);
  const uid = useId();
  const btnId = id || `zb${uid}`, listId = `zl${uid}`;
  const results = useMemo(() => searchZones(q).slice(0, 50), [q]);
  const sel = ZONES.find((e) => e.zone === canonicalZone(value));
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  // Scroll only when the active option changes — not on every parent re-render (UtcTool ticks every second).
  useEffect(() => { if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [act, open]);
  const pick = (z) => { onChange(z); setOpen(false); btn.current?.focus(); };
  return (
    <div className="zwrap" ref={ref}>
      <button type="button" ref={btn} id={btnId} aria-labelledby={labelledBy ? `${labelledBy} ${btnId}` : undefined} className="zbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(""); setAct(0); }}>
        <span className="zflag" aria-hidden="true">{sel ? sel.flag : <Globe2 size={16} />}</span>
        <span className="nm">{sel ? sel.label : allowNone ? "None (optional)" : "Select timezone"}</span>
        <span className="off">{value ? offsetLabel(value) : ""}</span>
      </button>
      {open && (
        <div className="zpop">
          <input autoFocus placeholder="Search country or city…" value={q} onChange={(e) => { setQ(e.target.value); setAct(0); }} aria-label="Search timezones"
            role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[act] ? `${listId}-${act}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && results[act]) { e.preventDefault(); pick(results[act].zone); }
            }} />
          <div className="zlist" role="listbox" id={listId} ref={list}>
            {allowNone && <button type="button" className="zitem" onClick={() => pick("")}><Ban size={15} aria-hidden="true" /><span>None</span></button>}
            {results.length === 0 && <div className="zempty">No match for “{q}”.</div>}
            {results.map((e, i) => (
              <button key={e.zone} id={`${listId}-${i}`} data-active={i === act} type="button" className="zitem" role="option" aria-selected={e.zone === value} tabIndex={-1}
                onClick={() => pick(e.zone)}>
                <span aria-hidden="true">{e.flag}</span><span className="zl"><span>{e.label}</span><span className="zz">{e.zone}</span></span><span className="zo">{offsetLabel(e.zone)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
