"use client";

import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DownloadType } from "@/lib/api";

interface DownloadButtonProps {
  mode: DownloadType;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function DownloadButton({ mode, onClick, disabled, busy }: DownloadButtonProps) {
  return (
    <Button size="lg" className="h-12 w-full" onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      {busy ? "Preparing…" : mode === "audio" ? "Download audio" : "Download video"}
    </Button>
  );
}
