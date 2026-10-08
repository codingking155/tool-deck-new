/* Pure helpers for the YouTube Downloader tool (no DOM, unit-tested in tests/ytdl-core.test.mjs).
   URL rules mirror the backend's validation.py; the server re-checks everything. */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/** → { ok: true, id, url } (canonical watch URL) or { ok: false, reason } */
export function checkYouTubeUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, reason: "Paste a YouTube link to get started." };
  if (input.length > 2048) return { ok: false, reason: "That link is too long." };
  // Browsers' URL parsers percent-encode spaces ("not a link" parses), Node's don't: reject up front for consistency.
  if (/\s/.test(input)) return { ok: false, reason: "That doesn't look like a valid link." };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`); }
  catch { return { ok: false, reason: "That doesn't look like a valid link." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Only http(s) links are supported." };
  if (u.username || u.password || (u.port && u.port !== "80" && u.port !== "443")) {
    return { ok: false, reason: "Only YouTube links are supported." };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const seg = u.pathname.split("/").filter(Boolean);
  let id = null;
  if (SHORT_HOSTS.has(host)) {
    if (seg.length === 1) id = seg[0];
  } else if (WATCH_HOSTS.has(host)) {
    if (seg.length === 1 && seg[0] === "watch") {
      const v = u.searchParams.getAll("v");
      id = v.length === 1 ? v[0] : null;
    } else if (seg.length === 2 && ["shorts", "live", "embed"].includes(seg[0])) id = seg[1];
  } else {
    return { ok: false, reason: "Only YouTube links are supported (youtube.com, youtu.be or Shorts)." };
  }
  if (!id || !VIDEO_ID.test(id)) return { ok: false, reason: "That YouTube link doesn't point to a single video." };
  return { ok: true, id, url: `https://www.youtube.com/watch?v=${id}` };
}

/** 34.8 MB, 182 MB, 1.2 GB */
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(digits).replace(/\.0$/, "")} ${units[i]}`;
}

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const t = Math.round(seconds), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Safe download filename on every major OS (mirrors the backend). */
export function sanitizeFilename(name, fallback = "video", max = 120) {
  let t = String(name ?? "").normalize("NFKC");
  t = Array.from(t).filter((ch) => { const c = ch.codePointAt(0); return c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f); }).join("");
  t = t.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  if (t.length > max) t = t.slice(0, max).replace(/[\s.]+$/, "");
  return !t || RESERVED.test(t) ? fallback : t;
}

/** Filename from a Content-Disposition header (RFC 6266 / 5987). */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* use plain filename */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** "My: video?.mp4" → "My video.mp4", keeping a short alphanumeric extension. */
export function safeDownloadName(name, fallbackExt) {
  const m = /^(.*?)(?:\.([A-Za-z0-9]{2,5}))?$/.exec(String(name ?? "").trim());
  return `${sanitizeFilename(m?.[1] ?? name)}.${(m?.[2] ?? fallbackExt).toLowerCase()}`;
}

const PREFER = { video: ["video-1080", "video-best"], audio: ["audio-mp3", "audio-m4a", "audio-best"] };

export const formatsOf = (video, mode) => video?.formats?.filter((f) => f.type === mode) ?? [];

/** Default option: 1080p (or best) for video, MP3 for audio — only among what's offered. */
export function defaultFormat(video, mode) {
  const list = formatsOf(video, mode);
  return PREFER[mode].find((id) => list.some((f) => f.format_id === id)) ?? list[0]?.format_id ?? null;
}

/** Label for a format option, e.g. "1080p · MP4", "Best available (2160p) · MP4", "MP3". */
export function formatLabel(f) {
  if (f.type === "audio") return f.format_id === "audio-best" ? `Best audio · ${f.extension.toUpperCase()}` : f.label;
  return f.format_id === "video-best" ? `Best available (${f.resolution}) · MP4` : `${f.label} · ${f.extension.toUpperCase()}`;
}

/* Error codes the backend returns that retrying can't change. */
export const PERMANENT_ERRORS = new Set(["invalid_url", "unsupported_url", "private", "members_only", "age_restricted",
  "paid", "restricted", "region_restricted", "unavailable", "removed", "live", "too_long"]);

export const ERROR_TITLES = {
  not_configured: "Not available on this deployment",
  backend_unavailable: "Can't reach the download service",
  network: "Connection problem",
  private: "This video is private",
  members_only: "Members-only video",
  age_restricted: "Sign-in required",
  paid: "Paid content",
  restricted: "Not publicly available",
  region_restricted: "Not available in this region",
  unavailable: "Video unavailable",
  removed: "Video removed",
  live: "Live streams aren't supported",
  rate_limited: "Slow down a little",
  bot_check: "YouTube is blocking the download server",
  too_many_jobs: "Downloads already running",
  busy: "Service is busy",
  ffmpeg_missing: "Conversion unavailable",
  processing_failed: "Processing failed",
  format_unavailable: "Format unavailable",
  too_large: "File too large",
  too_long: "Video too long",
};

/* Polling a job: a dropped connection or a 5xx with no error body (Render restarting, a proxy hiccup)
   is worth retrying; anything the backend answered with its own code (job_not_found, 4xx) is not. */
export const POLL_TRIES = 4;

export function isTransientPollError(e) {
  if (!e || e.name === "AbortError") return false;
  if (e.code === "backend_unavailable") return true;   // fetch failed, or a 5xx without a JSON detail
  return e.status >= 500 && e.code === `http_${e.status}`;
}

/** Backoff before retry n (1-based): 1 s, 2 s, 4 s … capped at 8 s. */
export const pollRetryDelay = (attempt) => Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1));
