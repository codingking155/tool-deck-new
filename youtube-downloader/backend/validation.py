"""Strict YouTube URL validation.

The user's URL is never handed to yt-dlp as-is. We parse it, check the host against an
allowlist, pull out the 11-character video ID, and rebuild a canonical
``https://www.youtube.com/watch?v=<id>`` URL. Whatever else the user put in the link
(other hosts, credentials, ports, redirects, playlist parameters) is discarded, so the
URL can't be used to make the server fetch arbitrary or private-network addresses.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from errors import invalid_url, unsupported_url

MAX_URL_LENGTH = 2048

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

WATCH_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
SHORT_HOSTS = {"youtu.be", "www.youtu.be"}


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def extract_video_id(raw: str) -> str:
    """Return the video ID for a supported YouTube URL or raise an ``ApiError``."""
    if not isinstance(raw, str):
        raise invalid_url()
    url = raw.strip()
    if not url or len(url) > MAX_URL_LENGTH:
        raise invalid_url()
    # Allow users to omit the scheme ("youtu.be/abc...").
    if "://" not in url:
        url = "https://" + url

    try:
        parts = urlsplit(url)
        port = parts.port  # raises ValueError for a malformed port
    except ValueError:
        raise invalid_url() from None

    if parts.scheme.lower() not in {"http", "https"}:
        raise invalid_url("Only http(s) links are supported.")
    if parts.username or parts.password or port not in (None, 80, 443):
        raise unsupported_url()

    host = (parts.hostname or "").lower().rstrip(".")
    segments = [s for s in parts.path.split("/") if s]

    video_id: str | None = None
    if host in SHORT_HOSTS:
        if len(segments) == 1:
            video_id = segments[0]
    elif host in WATCH_HOSTS:
        if segments == ["watch"]:
            values = parse_qs(parts.query).get("v", [])
            video_id = values[0] if len(values) == 1 else None
        elif len(segments) == 2 and segments[0] in {"shorts", "live", "embed"}:
            video_id = segments[1]
    else:
        raise unsupported_url()

    if video_id is None or not VIDEO_ID_RE.fullmatch(video_id):
        raise unsupported_url(
            "That YouTube link doesn't point to a single video. "
            "Use a youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/… link."
        )
    return video_id


def normalize_url(raw: str) -> tuple[str, str]:
    """Validate ``raw`` and return ``(video_id, canonical_url)``."""
    video_id = extract_video_id(raw)
    return video_id, canonical_url(video_id)
