"use client";

import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { DownloadProgress as Progression, DownloadStage } from "@/hooks/use-downloader";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS: { key: "fetch" | "process" | "save"; label: string }[] = [
  { key: "fetch", label: "Fetch" },
  { key: "process", label: "Process" },
  { key: "save", label: "Save" },
];

const STEP_INDEX: Record<DownloadStage, number> = { queued: 0, downloading: 0, processing: 1, saving: 2 };

const TITLES: Record<DownloadStage, string> = {
  queued: "Getting ready",
  downloading: "Downloading from YouTube",
  processing: "Processing",
  saving: "Saving to your device",
};

export function DownloadProgress({ progress, onCancel }: { progress: Progression; onCancel: () => void }) {
  const step = STEP_INDEX[progress.stage];
  const percent = progress.value == null ? null : Math.round(progress.value * 100);
  const loaded = formatBytes(progress.loaded);
  const total = formatBytes(progress.total);
  const details = [
    loaded && total ? `${loaded} of ${total}` : loaded,
    formatSpeed(progress.speed),
    formatEta(progress.eta),
  ].filter(Boolean);
  const title = progress.stage === "processing" && progress.message ? progress.message : TITLES[progress.stage];

  return (
    <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
      <ol className="flex items-center gap-2 text-xs" aria-label="Download steps">
        {STEPS.map((s, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              <span className={cn("font-medium", active || done ? "text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
              {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3" aria-live="polite">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground tabular">{percent == null ? "" : `${percent}%`}</p>
        </div>
        <Progress value={percent} aria-label={title} />
        <div className="flex min-h-5 items-center justify-between gap-3">
          <p className="truncate text-[13px] text-muted-foreground tabular">
            {details.length ? details.join(" · ") : progress.stage === "processing" ? "Almost there…" : "Hang tight…"}
          </p>
          <Button variant="ghost" size="sm" onClick={onCancel} className="-mr-2 shrink-0">
            <X aria-hidden />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
