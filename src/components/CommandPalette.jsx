import { useState, useEffect, useMemo, useRef } from "react";
import { TOOLS } from "../toolsMeta.js";

export default function CommandPalette({ open, onClose, nav, toggleTheme }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const restoreFocus = useRef(null);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  /* Modal focus: remember what had focus so it can be restored on close, and
     move focus into the dialog so a screen reader announces it as opened. */
  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement;
      inputRef.current?.focus();
    } else {
      restoreFocus.current?.focus?.();
      restoreFocus.current = null;
    }
  }, [open]);
  const items = useMemo(() => {
    const base = [
      ...TOOLS.map((t) => ({ label: `${t.icon}  ${t.name}`, d: "Open tool", run: () => nav(`/tool/${t.id}`) })),
      { label: "🏠  Home", d: "Go home", run: () => nav("/") },
      { label: "🌓  Toggle theme", d: "Light / dark", run: toggleTheme },
    ];
    return base.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  }, [q, nav, toggleTheme]);
  useEffect(() => {
    if (!open) return;
    const f = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === "Enter" && items[sel]) { items[sel].run(); onClose(); }
      /* Trap focus: the input is the only thing keyboard nav ever needs (arrow
         keys move the selection), so Tab never has to leave the dialog. */
      if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, items, sel, onClose]);
  if (!open) return null;
  return (
    <div className="cpov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={inputRef} placeholder="Type a command or tool…" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="cp-listbox"
          aria-activedescendant={items[sel] ? `cp-opt-${sel}` : undefined} />
        <div id="cp-listbox" role="listbox" aria-label="Matching commands" style={{ maxHeight: 330, overflowY: "auto" }}>
          {items.map((it, i) => (
            <button key={it.label} id={`cp-opt-${i}`} role="option" aria-selected={i === sel} className={`cpitem ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)}
              onClick={() => { it.run(); onClose(); }}>{it.label}<span className="d">{it.d}</span></button>
          ))}
          {items.length === 0 && <div className="zempty" role="status">Nothing matches.</div>}
        </div>
      </div>
    </div>
  );
}
