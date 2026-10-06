"use client";

import { AlertTriangle, CloudOff, Globe2, Lock, RotateCcw, Timer, VideoOff, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS: Record<string, { title: string; icon: LucideIcon }> = {
  backend_unavailable: { title: "Can't reach the server", icon: CloudOff },
  network: { title: "Connection problem", icon: CloudOff },
  invalid_url: { title: "That link doesn't look right", icon: AlertTriangle },
  unsupported_url: { title: "Unsupported link", icon: AlertTriangle },
  private: { title: "This video is private", icon: Lock },
  members_only: { title: "Members-only video", icon: Lock },
  age_restricted: { title: "Sign-in required", icon: Lock },
  paid: { title: "Paid content", icon: Lock },
  restricted: { title: "Not publicly available", icon: Lock },
  region_restricted: { title: "Not available in this region", icon: Globe2 },
  unavailable: { title: "Video unavailable", icon: VideoOff },
  removed: { title: "Video removed", icon: VideoOff },
  live: { title: "Live streams aren't supported", icon: VideoOff },
  rate_limited: { title: "Slow down a little", icon: Timer },
  too_many_jobs: { title: "Downloads already running", icon: Timer },
  busy: { title: "Server is busy", icon: Timer },
  ffmpeg_missing: { title: "FFmpeg isn't installed", icon: Wrench },
  processing_failed: { title: "Processing failed", icon: Wrench },
  format_unavailable: { title: "Format unavailable", icon: AlertTriangle },
  too_large: { title: "File too large", icon: AlertTriangle },
  too_long: { title: "Video too long", icon: AlertTriangle },
};

// Retrying won't change the outcome for these.
const PERMANENT = new Set([
  "invalid_url",
  "unsupported_url",
  "private",
  "members_only",
  "age_restricted",
  "paid",
  "restricted",
  "region_restricted",
  "unavailable",
  "removed",
  "live",
  "too_long",
]);

interface ErrorStateProps {
  code: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  compact?: boolean;
}

export function ErrorState({ code, message, onRetry, onDismiss, dismissLabel = "Choose another format", compact }: ErrorStateProps) {
  const preset = PRESETS[code] ?? { title: "Something went wrong", icon: AlertTriangle };
  const Icon = preset.icon;
  const canRetry = onRetry && !PERMANENT.has(code);

  return (
    <div
      role="alert"
      className={cn(
        "flex gap-4 rounded-2xl border border-destructive/30 bg-[color-mix(in_oklch,var(--destructive)_7%,var(--card))]",
        compact ? "p-4" : "p-5 shadow-[var(--shadow-soft)] sm:p-6",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] text-destructive">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{preset.title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
        {canRetry || onDismiss ? (
          <div className="flex flex-wrap gap-2 pt-3">
            {canRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            ) : null}
            {onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                {dismissLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
