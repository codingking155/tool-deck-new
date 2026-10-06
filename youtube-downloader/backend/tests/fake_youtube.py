"""A local stand-in for YouTube used by the tests.

``install(monkeypatch_or_none, base_url)`` replaces ``YoutubeDL.extract_info`` so that, for a
canonical watch URL, it returns an info dict whose formats point at small media files
served from ``base_url``. Everything after extraction (format selection, the HTTP
downloader, FFmpeg merging and audio extraction, progress hooks) is real yt-dlp code.

Special video IDs simulate failures: ``privateVid0`` (private), ``liveStream0`` (live),
``geoBlocked0`` (region-locked), ``deletedVid0`` (removed), ``rateLimit00`` (HTTP 429).
"""

from __future__ import annotations

import functools
import http.server
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import yt_dlp
from yt_dlp.utils import DownloadError

FAILURES = {
    "privateVid0": "ERROR: [youtube] privateVid0: Private video. Sign in if you've been granted access to this video",
    "geoBlocked0": "ERROR: [youtube] geoBlocked0: The uploader has not made this video available in your country",
    "deletedVid0": "ERROR: [youtube] deletedVid0: Video unavailable. This video has been removed by the uploader",
    "rateLimit00": "ERROR: [youtube] rateLimit00: HTTP Error 429: Too Many Requests",
}


def make_media(directory: Path) -> Path:
    """Create tiny h264/aac test files with FFmpeg (argument lists, no shell)."""
    directory.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required to generate test media")
    jobs = {
        "v1080.mp4": [
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1920x1080:rate=25",
            "-t",
            "2",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "ultrafast",
        ],
        "v720.mp4": [
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=25",
            "-t",
            "2",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "ultrafast",
        ],
        "v360.mp4": [
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=25",
            "-t",
            "2",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "ultrafast",
        ],
        "a128.m4a": ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-vn", "-c:a", "aac", "-b:a", "128k"],
    }
    for name, args in jobs.items():
        target = directory / name
        if not target.exists():
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args, str(target)], check=True)
    return directory


def serve(directory: Path) -> tuple[str, http.server.ThreadingHTTPServer]:
    handler = functools.partial(_QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}", server


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: Any) -> None:  # noqa: D401 - silence request logs
        pass


def fake_info(video_id: str, base_url: str, media: Path) -> dict[str, Any]:
    def fmt(format_id: str, name: str, **extra: Any) -> dict[str, Any]:
        return {
            "format_id": format_id,
            "url": f"{base_url}/{name}",
            "protocol": "http",
            "filesize": (media / name).stat().st_size,
            **extra,
        }

    info: dict[str, Any] = {
        "id": video_id,
        "title": 'Test clip: "Sample" / demo <1080p>',
        "channel": "Test Channel",
        "uploader": "Test Channel",
        "duration": 2,
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        "thumbnails": [{"url": "http://evil.internal/thumb.jpg", "preference": 99}],
        "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
        "original_url": f"https://www.youtube.com/watch?v={video_id}",
        "extractor": "youtube",
        "extractor_key": "Youtube",
        "live_status": "is_live" if video_id == "liveStream0" else "not_live",
        "availability": "public",
        "formats": [
            fmt("sb0", "v360.mp4", ext="mhtml", vcodec="none", acodec="none", format_note="storyboard"),
            fmt("140", "a128.m4a", ext="m4a", vcodec="none", acodec="mp4a.40.2", abr=128, format_note="medium"),
            fmt(
                "134",
                "v360.mp4",
                ext="mp4",
                vcodec="avc1.4d401e",
                acodec="none",
                width=640,
                height=360,
                fps=25,
                format_note="360p",
            ),
            fmt(
                "136",
                "v720.mp4",
                ext="mp4",
                vcodec="avc1.4d401f",
                acodec="none",
                width=1280,
                height=720,
                fps=25,
                format_note="720p",
            ),
            fmt(
                "137",
                "v1080.mp4",
                ext="mp4",
                vcodec="avc1.640028",
                acodec="none",
                width=1920,
                height=1080,
                fps=25,
                format_note="1080p",
            ),
        ],
    }
    return info


def install(monkeypatch: Any, base_url: str, media: Path) -> None:
    def extract_info(self: yt_dlp.YoutubeDL, url: str, download: bool = True, *args: Any, **kwargs: Any) -> Any:
        prefix = "https://www.youtube.com/watch?v="
        if not url.startswith(prefix):
            raise AssertionError(f"downloader received a non-canonical URL: {url}")
        video_id = url[len(prefix) :]
        if video_id in FAILURES:
            raise DownloadError(FAILURES[video_id])
        ie_result = fake_info(video_id, base_url, media)
        return self.process_ie_result(ie_result, download=download)

    if monkeypatch is None:
        yt_dlp.YoutubeDL.extract_info = extract_info  # type: ignore[method-assign]
    else:
        monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", extract_info)
