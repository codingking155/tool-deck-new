"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20 ${className}`}
    >
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? "Copied!" : label}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
