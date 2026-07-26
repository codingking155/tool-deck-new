import { useState, useEffect, useMemo } from "react";
import { TOOLS } from "../toolsMeta.js";

export default function CommandPalette({ open, onClose, nav, toggleTheme }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
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
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, items, sel, onClose]);
  if (!open) return null;
  return (
    <div className="cpov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp" role="dialog" aria-label="Command palette">
        <input autoFocus placeholder="Type a command or tool…" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} />
        <div style={{ maxHeight: 330, overflowY: "auto" }}>
          {items.map((it, i) => (
            <button key={it.label} className={`cpitem ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)}
              onClick={() => { it.run(); onClose(); }}>{it.label}<span className="d">{it.d}</span></button>
          ))}
          {items.length === 0 && <div className="zempty">Nothing matches.</div>}
        </div>
      </div>
    </div>
  );
}
