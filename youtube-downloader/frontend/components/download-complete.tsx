"use client";

import { motion } from "framer-motion";
import { Check, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

interface DownloadCompleteProps {
  filename: string;
  size: number;
  onDownloadAgain: () => void;
  onNewVideo: () => void;
}

export function DownloadComplete({ filename, size, onDownloadAgain, onNewVideo }: DownloadCompleteProps) {
  return (
    <div className="space-y-4 rounded-xl border border-success/30 bg-[color-mix(in_oklch,var(--success)_8%,var(--card))] p-4" role="status">
      <div className="flex items-start gap-3">
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-background"
        >
          <Check className="size-5" strokeWidth={2.75} aria-hidden />
        </motion.span>
        <div className="min-w-0">
          <p className="font-medium">Download complete</p>
          <p className="truncate text-sm text-muted-foreground" title={filename}>
            {filename}
            {formatBytes(size) ? ` · ${formatBytes(size)}` : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-2 min-[380px]:grid-cols-2">
        <Button variant="outline" onClick={onDownloadAgain}>
          <RotateCcw aria-hidden />
          Download again
        </Button>
        <Button variant="secondary" onClick={onNewVideo}>
          <Plus aria-hidden />
          New video
        </Button>
      </div>
    </div>
  );
}
