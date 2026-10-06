import { useState, useEffect, useMemo, useRef } from "react";
import { Search, CornerDownLeft, House, SunMoon, Link2, History } from "lucide-react";
import { TOOLS, WHERE_LABEL } from "../toolsMeta.js";
import { searchTools, highlightRuns } from "../lib/toolSearch.js";
import ToolIcon from "./ToolIcon.jsx";

function Hl({ text, idx }) {
  return highlightRuns(text, idx).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>));
}

/* Cmd/Ctrl+K launcher. One flat, keyboard-first list rendered in groups:
   Recent (empty query) → Tools (ranked) → Commands. */
export default function CommandPalette({ open, onClose, nav, toggleTheme, theme, recent = [], notify }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
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

  const groups = useMemo(() => {
    const toolItem = (r, group) => ({
      key: `${group}-${r.tool.id}`, group, tool: r.tool, hl: r.hl,
      run: () => nav(`/tool/${r.tool.id}`),
    });
    const commands = [
      { key: "c-home", label: "Go to all tools", kw: "home all tools browse", icon: House, run: () => nav("/") },
      { key: "c-theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, kw: "theme dark light mode toggle appearance", icon: SunMoon, hint: "Ctrl /", run: toggleTheme },
      { key: "c-link", label: "Copy link to this page", kw: "copy link share url", icon: Link2,
        run: () => navigator.clipboard?.writeText(window.location.href).then(() => notify?.("Link copied."), () => notify?.("Couldn't copy — select and copy manually.")) },
    ];
    const needle = q.trim().toLowerCase();
    const out = [];
    if (!needle) {
      const rec = recent.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean).slice(0, 4);
      if (rec.length) out.push({ name: "Recent", items: rec.map((t) => toolItem({ tool: t, hl: [] }, "Recent")) });
      const rest = TOOLS.filter((t) => !rec.includes(t));
      out.push({ name: rec.length ? "All tools" : "Tools", items: rest.map((t) => toolItem({ tool: t, hl: [] }, "Tools")) });
      out.push({ name: "Commands", items: commands });
    } else {
      const hits = searchTools(TOOLS, needle);
      if (hits.length) out.push({ name: "Tools", items: hits.map((r) => toolItem(r, "Tools")) });
      const cmds = commands.filter((c) => `${c.label} ${c.kw}`.toLowerCase().includes(needle));
      if (cmds.length) out.push({ name: "Commands", items: cmds });
    }
    return out;
  }, [q, nav, toggleTheme, theme, recent, notify]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /* keep the selected row in view as arrows move through the list */
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useEffect(() => {
    if (!open) return;
    const f = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % Math.max(flat.length, 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + flat.length) % Math.max(flat.length, 1)); }
      if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setSel(0); }
      if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setSel(flat.length - 1); }
      if (e.key === "Enter" && flat[sel]) { e.preventDefault(); flat[sel].run(); onClose(); }
      /* Trap focus: the input is the only thing keyboard nav ever needs (arrow
         keys move the selection), so Tab never has to leave the dialog. */
      if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, flat, sel, onClose]);
  if (!open) return null;

  let i = -1;
  return (
    <div className="cpov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Search tools and commands">
        <div className="cp-in">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} placeholder="Search tools — try “pdf”, “utc”, “mp3”…" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
            role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="cp-listbox" spellCheck={false} autoComplete="off"
            aria-activedescendant={flat[sel] ? `cp-opt-${sel}` : undefined} />
          <kbd className="kbd" aria-hidden="true">Esc</kbd>
        </div>
        <div className="cp-list" id="cp-listbox" role="listbox" aria-label="Results" ref={listRef}>
          {groups.map((g) => (
            <div role="group" aria-labelledby={`cpg-${g.name}`} key={g.name}>
              <div className="cp-group" id={`cpg-${g.name}`}>{g.name === "Recent" ? <><History size={11} aria-hidden="true"/>Recent</> : g.name}</div>
              {g.items.map((it) => {
                i += 1;
                const idx = i;
                const t = it.tool;
                const Icon = it.icon;
                return (
                  <div key={it.key} id={`cp-opt-${idx}`} data-i={idx} role="option" aria-selected={idx === sel}
                    className={`cpitem ${idx === sel ? "sel" : ""}`} style={t ? { "--cc": t.c } : undefined}
                    onMouseMove={() => idx !== sel && setSel(idx)} onClick={() => { it.run(); onClose(); }}>
                    <span className="cic" aria-hidden="true">{t ? <ToolIcon tool={t} size={16} /> : <Icon size={16} />}</span>
                    <span className="cl">
                      <b>{t ? <Hl text={t.name} idx={it.hl} /> : it.label}</b>
                      {t && <small>{t.cat} · {WHERE_LABEL[t.where][0]}</small>}
                    </span>
                    <span className="cmeta">
                      {t?.beta && <span className="betabadge">Beta</span>}
                      {it.hint && <kbd className="kbd">{it.hint}</kbd>}
                      <CornerDownLeft size={14} className="ret" aria-hidden="true" />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="zempty" role="status">No tool matches “{q.trim()}”. Try a task word like “compress”, “ip” or “timezone”.</div>}
        </div>
        <div className="cp-foot" aria-hidden="true">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          <span className="r">{TOOLS.length} tools</span>
        </div>
      </div>
    </div>
  );
}
