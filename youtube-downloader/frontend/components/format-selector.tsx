"use client";

import { Film, Music2 } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DownloadType, VideoFormat } from "@/lib/api";
import { formatBytes } from "@/lib/format";

interface FormatSelectorProps {
  mode: DownloadType;
  onModeChange: (mode: DownloadType) => void;
  formats: VideoFormat[];
  hasVideo: boolean;
  hasAudio: boolean;
  value: string | null;
  onChange: (formatId: string) => void;
  disabled?: boolean;
}

function optionText(format: VideoFormat) {
  if (format.type === "audio") {
    return format.format_id === "audio-best" ? `Best audio • ${format.extension.toUpperCase()}` : format.label;
  }
  return format.format_id === "video-best"
    ? `Best available (${format.resolution}) • MP4`
    : `${format.label} • ${format.extension.toUpperCase()}`;
}

export function FormatSelector({
  mode,
  onModeChange,
  formats,
  hasVideo,
  hasAudio,
  value,
  onChange,
  disabled,
}: FormatSelectorProps) {
  const selected = formats.find((f) => f.format_id === value);
  const size = formatBytes(selected?.filesize);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id="format-label" className="text-sm font-medium">
          Format
        </span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => next && onModeChange(next as DownloadType)}
          aria-label="Download type"
          disabled={disabled}
          className="w-full min-[380px]:w-auto"
        >
          <ToggleGroupItem value="video" disabled={!hasVideo} aria-label="Video">
            <Film aria-hidden />
            Video
          </ToggleGroupItem>
          <ToggleGroupItem value="audio" disabled={!hasAudio} aria-label="Audio only">
            <Music2 aria-hidden />
            Audio
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled || formats.length === 0}>
        <SelectTrigger aria-labelledby="format-label" aria-describedby="format-hint">
          <SelectValue placeholder="Choose a format" />
        </SelectTrigger>
        <SelectContent>
          {formats.map((format) => {
            const bytes = formatBytes(format.filesize);
            return (
              <SelectItem
                key={format.format_id}
                value={format.format_id}
                aside={
                  <span className="flex flex-col items-end leading-tight">
                    {format.note && format.type === "video" ? <span>{format.note}</span> : null}
                    {bytes ? <span>~{bytes}</span> : null}
                  </span>
                }
              >
                {optionText(format)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <p id="format-hint" className="min-h-5 text-[13px] text-muted-foreground tabular">
        {selected
          ? [
              selected.type === "audio" ? selected.note : selected.note ? `${selected.note} video with audio` : null,
              selected.type === "audio" && selected.resolution ? selected.resolution : null,
              size ? `about ${size}` : "size unknown",
            ]
              .filter(Boolean)
              .join(" · ")
          : null}
      </p>
    </div>
  );
}
