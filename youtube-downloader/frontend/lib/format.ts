/** 34.8 MB, 182 MB, 1.2 GB — at most three significant digits. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string | null {
  const bytes = formatBytes(bytesPerSecond);
  return bytes ? `${bytes}/s` : null;
}

export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Make a string safe to use as a download filename (mirrors the backend). */
export function sanitizeFilename(name: string | null | undefined, fallback = "video", maxLength = 120): string {
  let text = (name ?? "").normalize("NFKC");
  // Strip control characters, then characters that are invalid on common filesystems.
  text = Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
    })
    .join("");
  text = text
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (text.length > maxLength) text = text.slice(0, maxLength).replace(/[\s.]+$/, "");
  if (!text || RESERVED.test(text)) return fallback;
  return text;
}

/** Read the filename from a Content-Disposition header (RFC 6266 / 5987). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Split "My video.mp4" into a sanitized base name and a safe extension. */
export function safeDownloadName(name: string, fallbackExt: string): string {
  const match = /^(.*?)(?:\.([A-Za-z0-9]{2,5}))?$/.exec(name.trim());
  const base = sanitizeFilename(match?.[1] ?? name);
  const ext = (match?.[2] ?? fallbackExt).toLowerCase();
  return `${base}.${ext}`;
}
