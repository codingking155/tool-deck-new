"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import CopyButton from "./CopyButton";

export default function CodeTabs({ tabs }: { tabs: { label: string; code: string }[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-[#0d1714] shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2">
        <div role="tablist" aria-label="Example request language" className="flex overflow-x-auto" onKeyDown={onKey}>
          {tabs.map((t, i) => (
            <button
              key={t.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel-${i}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                i === active ? "border-emerald-400 text-white" : "border-transparent text-white/60 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton text={tabs[active].code} />
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active}>
          <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-emerald-50">
            <code>{t.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
