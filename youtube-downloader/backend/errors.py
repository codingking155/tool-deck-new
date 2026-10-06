"""User-facing errors.

Every failure that reaches the client is an ``ApiError`` with a stable machine-readable
``code`` and a friendly ``message``. Raw yt-dlp / FFmpeg output is logged server-side and
never returned, so tracebacks, paths and internal hostnames don't leak.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("downloader")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "detail": self.message}


def invalid_url(message: str = "That doesn't look like a valid YouTube link.") -> ApiError:
    return ApiError(400, "invalid_url", message)


def unsupported_url(
    message: str = "Only YouTube video links are supported (youtube.com/watch, youtu.be or Shorts).",
) -> ApiError:
    return ApiError(400, "unsupported_url", message)


def ffmpeg_missing() -> ApiError:
    return ApiError(
        503,
        "ffmpeg_missing",
        "This format needs FFmpeg, which isn't installed on the server. Try another format.",
    )


# Ordered: the first pattern that matches the (lower-cased) yt-dlp message wins.
_RULES: list[tuple[re.Pattern[str], ApiError]] = [
    (
        re.compile(r"requested format is not available|no video formats found|format not available"),
        ApiError(422, "format_unavailable", "That format isn't available for this video. Pick another one."),
    ),
    (
        re.compile(r"private video|video is private"),
        ApiError(
            403,
            "private",
            "Only public videos can be downloaded. Ask the owner to share it publicly, or download it from your own channel.",
        ),
    ),
    (
        re.compile(r"members[- ]only|join this channel|available to this channel's members"),
        ApiError(403, "members_only", "This video is for channel members only and can't be downloaded here."),
    ),
    (
        re.compile(r"sign in to confirm your age|age[- ]restricted|inappropriate for some users"),
        ApiError(403, "age_restricted", "This video is age-restricted and requires signing in, which isn't supported."),
    ),
    (
        re.compile(r"sign in to confirm you.?re not a bot|confirm you are not a robot"),
        ApiError(
            429,
            "rate_limited",
            "YouTube is temporarily limiting requests from this server. Please try again in a few minutes.",
        ),
    ),
    (
        re.compile(r"requires payment|purchase|rental|premium"),
        ApiError(403, "paid", "This is paid content and can't be downloaded here."),
    ),
    (
        re.compile(
            r"not available in your country|geo.?restrict|blocked it in your country|uploader has not made this video available"
        ),
        ApiError(
            451,
            "region_restricted",
            "We couldn't access this video. Make sure the link is public and available in your region.",
        ),
    ),
    (
        re.compile(r"copyright"),
        ApiError(410, "removed", "This video has been removed because of a copyright claim."),
    ),
    (
        re.compile(r"removed|terminated|deleted|no longer available|does not exist|video unavailable|not available"),
        ApiError(404, "unavailable", "This video is unavailable. It may have been deleted or made private."),
    ),
    (
        re.compile(r"\b429\b|too many requests|rate.?limit"),
        ApiError(
            429,
            "rate_limited",
            "YouTube is temporarily limiting requests from this server. Please try again in a few minutes.",
        ),
    ),
    (
        re.compile(r"ffmpeg|ffprobe"),
        ApiError(
            500,
            "processing_failed",
            "We couldn't process the file (merging or converting failed). Try a different format.",
        ),
    ),
    (
        re.compile(r"max.?filesize|file is larger than max"),
        ApiError(413, "too_large", "This file is larger than the server allows. Try a lower quality."),
    ),
    (
        re.compile(r"timed out|timeout|connection|network|unreachable|name resolution|ssl|proxy|tunnel"),
        ApiError(
            502,
            "network",
            "We couldn't reach YouTube right now. Check back in a moment.",
        ),
    ),
]


def translate(exc: BaseException, *, fallback: ApiError) -> ApiError:
    """Map an arbitrary extractor/postprocessor exception to a friendly ``ApiError``."""
    if isinstance(exc, ApiError):
        return exc
    text = str(exc).lower()
    for pattern, error in _RULES:
        if pattern.search(text):
            logger.info("yt-dlp failure mapped to %s: %s", error.code, exc)
            return ApiError(error.status_code, error.code, error.message)
    logger.warning("Unclassified yt-dlp failure: %s", exc)
    return fallback
