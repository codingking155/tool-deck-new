"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, Star, X } from "lucide-react";
import { GitHubIcon } from "./icons";

export default function MobileNav({ links, githubUrl }: { links: { href: string; label: string }[]; githubUrl: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-lg border border-line bg-white/80 text-ink"
      >
        {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="card absolute inset-x-4 top-16 flex flex-col p-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 font-medium text-ink hover:bg-mint">
              {l.label}
            </Link>
          ))}
          <a href={githubUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-3 font-medium text-ink hover:bg-mint">
            <GitHubIcon /> <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" /> Star on GitHub
          </a>
        </nav>
      )}
    </div>
  );
}
