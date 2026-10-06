"use client";

import Image from "next/image";
import { useState } from "react";
import { Clock3, ImageOff, UserRound } from "lucide-react";

import type { VideoInfo } from "@/lib/api";
import { formatDuration } from "@/lib/format";

/** Thumbnail, title, channel and duration. Actions are passed in as children. */
export function VideoPreview({ video, children }: { video: VideoInfo; children: React.ReactNode }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const duration = formatDuration(video.duration);

  return (
    <article
      aria-labelledby="video-title"
      className="grid gap-6 rounded-2xl border bg-card p-4 shadow-[var(--shadow-lift)] sm:p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
    >
      <div className="relative aspect-video w-full self-start overflow-hidden rounded-xl bg-muted ring-1 ring-border">
        {video.thumbnail && !thumbFailed ? (
          <Image
            src={video.thumbnail}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 768px) 560px, 100vw"
            className="object-cover"
            referrerPolicy="no-referrer"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden />
          </div>
        )}
        {duration ? (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular">
            {duration}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col">
        <h2 id="video-title" className="line-clamp-2 text-lg leading-snug font-semibold tracking-tight text-balance sm:text-xl" title={video.title}>
          {video.title}
        </h2>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{video.channel}</span>
          </span>
          {duration ? (
            <>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1.5 tabular">
                <Clock3 className="size-4" aria-hidden />
                <span className="sr-only">Duration</span>
                {duration}
              </span>
            </>
          ) : null}
        </p>
        <div className="mt-6 flex flex-1 flex-col justify-end gap-4">{children}</div>
      </div>
    </article>
  );
}
