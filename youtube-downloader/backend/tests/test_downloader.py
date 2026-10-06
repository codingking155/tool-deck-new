import pytest

from downloader import _quality_bucket, build_format_options, sanitize_filename
from errors import ApiError, translate


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('A/B: "C" <D>?', "A B C D"),
        ("  ..hidden..  ", "hidden"),
        ("CON", "video"),
        ("", "video"),
        ("line\nbreak\ttab", "linebreaktab"),
        ("Ünïcödé 🎵 title", "Ünïcödé 🎵 title"),
        ("x" * 300, "x" * 120),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_quality_bucket_handles_vertical_and_letterboxed():
    assert _quality_bucket({"width": 1080, "height": 1920}) == 1080  # Shorts
    assert _quality_bucket({"width": 1920, "height": 800, "format_note": "1080p60"}) == 1080
    assert _quality_bucket({"width": 256, "height": 144, "format_note": "144p"}) is None


def test_only_available_qualities_are_listed():
    info = {
        "duration": 60,
        "formats": [
            {"format_id": "a", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "abr": 128, "filesize": 1000},
            {"format_id": "v7", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 720, "width": 1280, "filesize": 5000},
            {"format_id": "v4", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 480, "width": 854},
        ],
    }
    ids = [o.format_id for o in build_format_options(info)]
    assert ids == ["video-best", "video-720", "video-480", "audio-best", "audio-mp3", "audio-m4a"]
    by_id = {o.format_id: o for o in build_format_options(info)}
    assert by_id["video-720"].filesize == 6000  # video + merged audio
    assert by_id["video-480"].filesize is None
    assert by_id["audio-mp3"].filesize == 60 * 192 * 1000 // 8


def test_audio_options_require_audio_streams():
    info = {"formats": [{"format_id": "v", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 360}]}
    assert [o.type for o in build_format_options(info)] == ["video", "video"]


@pytest.mark.parametrize(
    "message,code",
    [
        ("ERROR: Private video. Sign in if you've been granted access", "private"),
        ("ERROR: Join this channel to get access to members-only content", "members_only"),
        ("ERROR: Sign in to confirm your age", "age_restricted"),
        ("ERROR: Sign in to confirm you're not a bot", "rate_limited"),
        ("ERROR: The uploader has not made this video available in your country", "region_restricted"),
        ("ERROR: Video unavailable. This video has been removed by the uploader", "unavailable"),
        ("ERROR: HTTP Error 429: Too Many Requests", "rate_limited"),
        ("ERROR: Requested format is not available", "format_unavailable"),
        ("ERROR: Postprocessing: ffmpeg exited with code 1", "processing_failed"),
        ("ERROR: <urlopen error timed out>", "network"),
    ],
)
def test_error_translation(message, code):
    fallback = ApiError(500, "fallback", "x")
    assert translate(Exception(message), fallback=fallback).code == code


def test_unknown_errors_use_fallback_and_hide_details():
    fallback = ApiError(500, "download_failed", "The download failed.")
    error = translate(Exception("Traceback: /srv/secret/path.py line 3"), fallback=fallback)
    assert error.code == "download_failed"
    assert "secret" not in error.message
