"""yt-dlp integration: metadata extraction and downloads.

Only canonical YouTube watch URLs (built by ``validation.normalize_url``) reach this
module. yt-dlp runs through its Python API with a fixed option set: no shell, no user
controlled paths, output templates or format strings, no cookies and no credentials.
Content that yt-dlp can't fetch anonymously (private, members-only, paid, age-gated,
region-locked) fails with a friendly error; nothing here tries to work around it.
"""

from __future__ import annotations

import logging
import re
import shutil
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yt_dlp

from config import settings
from errors import ApiError, ffmpeg_missing, translate

logger = logging.getLogger("downloader")

# Quality labels we expose, highest first. Anything else (240p, 144p) is not listed.
STANDARD_HEIGHTS = (2160, 1440, 1080, 720, 480, 360)
HEIGHT_NOTES = {2160: "4K", 1440: "QHD", 1080: "Full HD", 720: "HD", 480: "SD", 360: "Low"}

THUMBNAIL_HOSTS = {"i.ytimg.com", "i9.ytimg.com", "img.youtube.com", "yt3.ggpht.com"}

MP3_BITRATE_KBPS = 192

PartialSuffixes = (".part", ".ytdl", ".temp", ".frag")


class DownloadCancelled(Exception):
    """Raised from the progress hook when the client cancelled the job."""


@dataclass(frozen=True)
class FormatOption:
    """A download choice offered to the client. ``format_id`` is an opaque option key
    (``video-1080``, ``audio-mp3``...), never a raw yt-dlp format selector."""

    format_id: str
    type: str  # "video" | "audio"
    label: str
    resolution: str | None
    extension: str
    note: str | None = None
    filesize: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "format_id": self.format_id,
            "type": self.type,
            "label": self.label,
            "resolution": self.resolution,
            "extension": self.extension,
            "note": self.note,
            "filesize": self.filesize,
        }


@dataclass(frozen=True)
class ProgressUpdate:
    stage: str  # "downloading" | "processing"
    progress: float | None  # 0..1 for the download stage
    downloaded_bytes: int | None = None
    total_bytes: int | None = None
    speed: float | None = None
    eta: int | None = None
    message: str | None = None


@dataclass(frozen=True)
class DownloadResult:
    path: Path
    filename: str  # sanitized, user-facing download name


ProgressCallback = Callable[[ProgressUpdate], None]


# --------------------------------------------------------------------------- helpers


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


class _YtDlpLogger:
    """Route yt-dlp output to Python logging instead of stdout/stderr."""

    def debug(self, msg: str) -> None:
        if not msg.startswith("[debug] "):
            logger.debug(msg)

    def info(self, msg: str) -> None:
        logger.debug(msg)

    def warning(self, msg: str) -> None:
        logger.info("yt-dlp warning: %s", msg)

    def error(self, msg: str) -> None:
        logger.info("yt-dlp error: %s", msg)


def _base_options() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _YtDlpLogger(),
        "noplaylist": True,
        # Only the YouTube video extractor may run, even if a URL somehow slipped through.
        "allowed_extractors": ["youtube"],
        "socket_timeout": settings.socket_timeout,
        "retries": 3,
        "fragment_retries": 3,
        "cachedir": False,
        "restrictfilenames": True,
        "windowsfilenames": True,
    }


def sanitize_filename(name: str | None, fallback: str = "video", max_length: int = 120) -> str:
    """Make a title safe to use as a download filename on every major OS."""
    text = unicodedata.normalize("NFKC", name or "")
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    text = re.sub(r'[<>:"/\\|?*]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if len(text) > max_length:
        text = text[:max_length].rstrip(" .")
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
    if not text or text.lower() in reserved:
        return fallback
    return text


def _safe_thumbnail(info: dict[str, Any]) -> str | None:
    candidates: list[str] = []
    if info.get("thumbnail"):
        candidates.append(info["thumbnail"])
    thumbs = sorted(
        (t for t in info.get("thumbnails") or [] if t.get("url")),
        key=lambda t: (t.get("preference") or 0, (t.get("width") or 0) * (t.get("height") or 0)),
        reverse=True,
    )
    candidates.extend(t["url"] for t in thumbs)
    for url in candidates:
        try:
            parts = urlsplit(url)
        except ValueError:
            continue
        if parts.scheme == "https" and (parts.hostname or "").lower() in THUMBNAIL_HOSTS:
            return url
    return None


def _size(fmt: dict[str, Any]) -> int | None:
    value = fmt.get("filesize") or fmt.get("filesize_approx")
    return int(value) if value else None


def _is_video(fmt: dict[str, Any]) -> bool:
    return (fmt.get("vcodec") or "none") != "none" and fmt.get("ext") != "mhtml"


def _is_audio_only(fmt: dict[str, Any]) -> bool:
    return (fmt.get("acodec") or "none") != "none" and not _is_video(fmt)


def _quality_bucket(fmt: dict[str, Any]) -> int | None:
    """Map a video format to one of ``STANDARD_HEIGHTS``.

    YouTube's ``format_note`` ("1080p60", "720p HDR") is the most reliable label for
    letterboxed and vertical videos; fall back to the short side of the frame.
    """
    note = fmt.get("format_note") or ""
    match = re.match(r"^(\d{3,4})p", note)
    if match:
        value = int(match.group(1))
    else:
        dims = [d for d in (fmt.get("width"), fmt.get("height")) if d]
        if not dims:
            return None
        value = min(dims)
    for height in STANDARD_HEIGHTS:
        if value >= height * 0.9:
            return height
    return None


def _check_playable(info: dict[str, Any]) -> None:
    live_status = info.get("live_status")
    if info.get("is_live") or live_status in {"is_live", "is_upcoming", "post_live"}:
        raise ApiError(422, "live", "Live streams and premieres can't be downloaded. Try again once the video is processed.")
    availability = info.get("availability")
    if availability in {"private", "premium_only", "subscriber_only", "needs_auth"}:
        raise ApiError(403, "restricted", "This video isn't publicly available, so it can't be downloaded here.")
    duration = info.get("duration")
    if duration and duration > settings.max_duration_seconds:
        hours = settings.max_duration_seconds / 3600
        raise ApiError(413, "too_long", f"This video is longer than the {hours:g}-hour limit.")


def build_format_options(info: dict[str, Any]) -> list[FormatOption]:
    formats = [f for f in info.get("formats") or [] if f.get("format_id")]
    videos = [f for f in formats if _is_video(f)]
    audios = [f for f in formats if _is_audio_only(f)]

    best_audio = max(audios, key=lambda f: (f.get("abr") or 0, _size(f) or 0), default=None)
    m4a_audios = [f for f in audios if f.get("ext") == "m4a"]
    best_m4a = max(m4a_audios, key=lambda f: (f.get("abr") or 0, _size(f) or 0), default=None)
    merge_audio_size = _size(best_m4a or best_audio or {}) or 0

    by_height: dict[int, list[dict[str, Any]]] = {}
    for fmt in videos:
        bucket = _quality_bucket(fmt)
        if bucket:
            by_height.setdefault(bucket, []).append(fmt)

    options: list[FormatOption] = []
    heights = [h for h in STANDARD_HEIGHTS if h in by_height]

    def estimate(height: int) -> int | None:
        group = by_height[height]
        # Same preference as the download selector: mp4 first, then the largest stream.
        best = max(group, key=lambda f: (f.get("ext") == "mp4", f.get("fps") or 0, _size(f) or 0))
        size = _size(best)
        if size is None:
            return None
        has_audio = (best.get("acodec") or "none") != "none"
        return size + (0 if has_audio else merge_audio_size)

    if heights:
        top = heights[0]
        options.append(
            FormatOption("video-best", "video", "Best available", f"{top}p", "mp4", HEIGHT_NOTES.get(top), estimate(top))
        )
        for height in heights:
            options.append(
                FormatOption(
                    f"video-{height}", "video", f"{height}p", f"{height}p", "mp4", HEIGHT_NOTES.get(height), estimate(height)
                )
            )

    if best_audio:
        duration = info.get("duration") or 0
        best_ext = best_audio.get("ext") or "m4a"
        abr = best_audio.get("abr")
        options.append(
            FormatOption(
                "audio-best",
                "audio",
                "Best audio",
                f"{round(abr)} kbps" if abr else None,
                best_ext,
                "Original quality, no conversion",
                _size(best_audio),
            )
        )
        options.append(
            FormatOption(
                "audio-mp3",
                "audio",
                "MP3",
                f"{MP3_BITRATE_KBPS} kbps",
                "mp3",
                "Plays everywhere",
                int(duration * MP3_BITRATE_KBPS * 1000 / 8) if duration else None,
            )
        )
        options.append(
            FormatOption(
                "audio-m4a",
                "audio",
                "M4A",
                f"{round(best_m4a['abr'])} kbps" if best_m4a and best_m4a.get("abr") else None,
                "m4a",
                "AAC, great for Apple devices",
                _size(best_m4a) if best_m4a else None,
            )
        )
    return options


OPTION_ID_RE = re.compile(rf"^(video-(best|{'|'.join(map(str, STANDARD_HEIGHTS))})|audio-(best|mp3|m4a))$")


def _download_options(option_id: str) -> tuple[dict[str, Any], bool]:
    """Translate an option key into yt-dlp options. Returns ``(options, needs_ffmpeg)``."""
    if not OPTION_ID_RE.fullmatch(option_id):
        raise ApiError(422, "format_unavailable", "That format isn't available for this video. Pick another one.")

    kind, _, value = option_id.partition("-")
    if kind == "video":
        resolution = "res" if value == "best" else f"res:{value}"
        return (
            {
                # Separate video+audio streams merged by FFmpeg; a single progressive file is the fallback.
                "format": "bv*+ba/b",
                "format_sort": [resolution, "ext:mp4:m4a"],
                "merge_output_format": "mp4",
            },
            True,
        )

    if value == "best":
        return {"format": "ba/b"}, False
    if value == "mp3":
        return (
            {
                "format": "ba/b",
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": str(MP3_BITRATE_KBPS)}
                ],
            },
            True,
        )
    # m4a: take the native AAC stream when there is one (remux only, no re-encode).
    return (
        {
            "format": "ba[ext=m4a]/ba/b",
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}],
        },
        True,
    )


# --------------------------------------------------------------------------- public API


def get_video_info(url: str) -> dict[str, Any]:
    """Return metadata and the download options available for a canonical video URL."""
    try:
        with yt_dlp.YoutubeDL({**_base_options(), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except ApiError:
        raise
    except Exception as exc:  # yt-dlp raises DownloadError/ExtractorError and friends
        raise translate(
            exc, fallback=ApiError(502, "info_failed", "We couldn't read this video's details. Please try again.")
        ) from None

    if not info or info.get("_type") not in (None, "video"):
        raise ApiError(400, "unsupported_url", "That link doesn't point to a single video.")
    _check_playable(info)

    options = build_format_options(info)
    if not options:
        raise ApiError(422, "format_unavailable", "No downloadable formats were found for this video.")

    return {
        "id": info.get("id"),
        "title": info.get("title") or "Untitled video",
        "thumbnail": _safe_thumbnail(info),
        "channel": info.get("channel") or info.get("uploader") or "Unknown channel",
        "duration": info.get("duration"),
        "formats": [option.to_dict() for option in options],
    }


def download_video(
    url: str,
    format_id: str | None,
    job_dir: Path,
    *,
    on_progress: ProgressCallback | None = None,
    is_cancelled: Callable[[], bool] = lambda: False,
) -> DownloadResult:
    """Download ``url`` into ``job_dir`` (a fresh, server-chosen directory)."""
    option_id = format_id or "video-best"
    extra, needs_ffmpeg = _download_options(option_id)
    if needs_ffmpeg and not ffmpeg_available():
        raise ffmpeg_missing()

    job_dir.mkdir(parents=True, exist_ok=True)
    expected: dict[str, int] = {}
    finished: set[str] = set()
    best_progress = 0.0

    def emit(update: ProgressUpdate) -> None:
        if on_progress:
            on_progress(update)

    def progress_hook(d: dict[str, Any]) -> None:
        nonlocal best_progress
        if is_cancelled():
            raise DownloadCancelled()
        part_id = str((d.get("info_dict") or {}).get("format_id") or d.get("filename"))
        downloaded = d.get("downloaded_bytes") or 0
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if total and part_id not in expected:
            expected[part_id] = int(total)
        if d.get("status") == "finished":
            finished.add(part_id)
            expected[part_id] = max(expected.get(part_id, 0), int(downloaded or total or 0))

        overall_total = sum(expected.values())
        done = sum(expected[p] for p in finished if p in expected)
        current = 0 if part_id in finished else downloaded
        fraction = (done + current) / overall_total if overall_total else None
        if fraction is not None:
            # Merged downloads fetch two streams; never let the bar move backwards.
            best_progress = max(best_progress, min(fraction, 1.0))
        emit(
            ProgressUpdate(
                stage="downloading",
                progress=best_progress if fraction is not None else None,
                downloaded_bytes=done + current,
                total_bytes=overall_total or None,
                speed=d.get("speed"),
                eta=d.get("eta"),
            )
        )

    def postprocessor_hook(d: dict[str, Any]) -> None:
        if is_cancelled():
            raise DownloadCancelled()
        if d.get("status") == "started":
            name = d.get("postprocessor") or ""
            message = {
                "Merger": "Merging video and audio",
                "ExtractAudio": "Converting audio",
            }.get(name)
            if message:
                emit(ProgressUpdate(stage="processing", progress=1.0, message=message))

    options = {
        **_base_options(),
        **extra,
        "paths": {"home": str(job_dir), "temp": str(job_dir)},
        "outtmpl": {"default": "%(id)s.%(ext)s"},
        "max_filesize": settings.max_filesize_bytes,
        "overwrites": True,
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
    }

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise ApiError(404, "unavailable", "This video is unavailable.")
            _check_playable(info)
            for part in info.get("requested_formats") or [info]:
                size = _size(part)
                if size and part.get("format_id"):
                    expected[str(part["format_id"])] = size
            emit(ProgressUpdate(stage="downloading", progress=0.0, message="Starting download"))
            ydl.process_ie_result(info, download=True)
    except (ApiError, DownloadCancelled):
        raise
    except Exception as exc:
        if is_cancelled():
            raise DownloadCancelled() from None
        raise translate(exc, fallback=ApiError(500, "download_failed", "The download failed. Please try again.")) from None

    path = _find_output(job_dir)
    title = sanitize_filename(info.get("title"))
    return DownloadResult(path=path, filename=f"{title}{path.suffix.lower()}")


def _find_output(job_dir: Path) -> Path:
    candidates = [
        p for p in job_dir.iterdir() if p.is_file() and not p.name.endswith(PartialSuffixes) and not p.name.startswith(".")
    ]
    if not candidates:
        raise ApiError(500, "download_failed", "The download finished but the file could not be found.")
    # Intermediates are deleted after merging/conversion; if any remain, the final file is the largest.
    return max(candidates, key=lambda p: p.stat().st_size)
