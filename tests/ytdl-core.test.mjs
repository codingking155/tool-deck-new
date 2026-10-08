import test from "node:test";
import assert from "node:assert/strict";
import {
  checkYouTubeUrl, formatBytes, formatDuration, sanitizeFilename, filenameFromDisposition, safeDownloadName,
  defaultFormat, formatLabel,
} from "../src/tools/ytdl/core.js";

test("accepts the supported YouTube link shapes and canonicalises them", () => {
  for (const [raw, id] of [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ?si=x", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/abcdefghijk", "abcdefghijk"],
  ]) {
    const r = checkYouTubeUrl(raw);
    assert.ok(r.ok, raw);
    assert.equal(r.url, `https://www.youtube.com/watch?v=${id}`);
  }
});

test("rejects other hosts, look-alikes, credentials, playlists and non-http schemes", () => {
  for (const raw of ["", "javascript:alert(1)", "ftp://youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://u:p@youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com:8080/watch?v=dQw4w9WgXcQ", "http://169.254.169.254/",
    "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/watch?v=short", "https://youtu.be/dQw4w9WgXcQ/x"]) {
    assert.equal(checkYouTubeUrl(raw).ok, false, raw);
  }
});

test("text with spaces is reported as an invalid link, not an unsupported host", () => {
  assert.equal(checkYouTubeUrl("not a link").reason, "That doesn't look like a valid link.");
  assert.equal(checkYouTubeUrl("https://youtu.be/dQw4w9WgXcQ extra").ok, false);
  assert.equal(checkYouTubeUrl("  https://youtu.be/dQw4w9WgXcQ  ").ok, true);   // surrounding whitespace is trimmed
});

test("formats sizes and durations", () => {
  assert.equal(formatBytes(34.8 * 1024 * 1024), "34.8 MB");
  assert.equal(formatBytes(182 * 1024 * 1024), "182 MB");
  assert.equal(formatBytes(1.2 * 1024 ** 3), "1.2 GB");
  assert.equal(formatBytes(0), null);
  assert.equal(formatDuration(765), "12:45");
  assert.equal(formatDuration(3725), "1:02:05");
});

test("sanitizes filenames", () => {
  assert.equal(sanitizeFilename('A/B: "C" <D>?'), "A B C D");
  assert.equal(sanitizeFilename("CON"), "video");
  assert.equal(sanitizeFilename("a\u0000b\nc"), "abc");
  assert.equal(safeDownloadName("../../etc/passwd.mp4", "mp4"), "etc passwd.mp4");
  assert.equal(filenameFromDisposition(`attachment; filename*=utf-8''%C3%9Cber%20clip.mp4`), "Über clip.mp4");
  assert.equal(filenameFromDisposition('attachment; filename="clip.mp3"'), "clip.mp3");
});

test("picks a sensible default among the offered formats", () => {
  const video = { formats: [
    { format_id: "video-best", type: "video", label: "Best available", resolution: "720p", extension: "mp4" },
    { format_id: "video-720", type: "video", label: "720p", resolution: "720p", extension: "mp4" },
    { format_id: "audio-mp3", type: "audio", label: "MP3", extension: "mp3" },
  ] };
  assert.equal(defaultFormat(video, "video"), "video-best");
  assert.equal(defaultFormat(video, "audio"), "audio-mp3");
  assert.equal(formatLabel(video.formats[0]), "Best available (720p) · MP4");
});

test("poll retries: only dropped connections and bare 5xx are transient", async () => {
  const { isTransientPollError, pollRetryDelay, POLL_TRIES } = await import("../src/tools/ytdl/core.js");
  const { DownloaderError } = await import("../src/tools/ytdl/api.js");
  assert.equal(isTransientPollError(new DownloaderError("offline", "backend_unavailable")), true);
  assert.equal(isTransientPollError(new DownloaderError("offline", "backend_unavailable", 502)), true);
  assert.equal(isTransientPollError({ code: "http_500", status: 500 }), true);
  // the backend answered with its own code: retrying can't help
  assert.equal(isTransientPollError(new DownloaderError("gone", "job_not_found", 404)), false);
  assert.equal(isTransientPollError({ code: "rate_limited", status: 429 }), false);
  assert.equal(isTransientPollError({ code: "http_400", status: 400 }), false);
  assert.equal(isTransientPollError({ code: "ffmpeg_missing", status: 503 }), false);
  assert.equal(isTransientPollError(new DOMException("Aborted", "AbortError")), false);
  assert.equal(isTransientPollError(null), false);
  assert.deepEqual([1, 2, 3, 4, 9].map(pollRetryDelay), [1000, 2000, 4000, 8000, 8000]);
  assert.ok(POLL_TRIES >= 2);
});

test("YouTube's bot check has its own title, distinct from rate limiting", async () => {
  const { ERROR_TITLES, PERMANENT_ERRORS } = await import("../src/tools/ytdl/core.js");
  assert.ok(ERROR_TITLES.bot_check);
  assert.notEqual(ERROR_TITLES.bot_check, ERROR_TITLES.rate_limited);
  assert.equal(PERMANENT_ERRORS.has("bot_check"), false);   // it can clear later, so "Try again" stays
});
