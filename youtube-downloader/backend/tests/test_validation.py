import pytest

from errors import ApiError
from validation import normalize_url

VALID = [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123", "dQw4w9WgXcQ"),
    ("http://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"),
    ("youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/abcdefghijk", "abcdefghijk"),
    ("  https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ  ", "dQw4w9WgXcQ"),
]

INVALID = [
    "",
    "not a url",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://vimeo.com/123456",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://evil.com/?u=https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:8080/watch?v=dQw4w9WgXcQ",
    "http://127.0.0.1/watch?v=dQw4w9WgXcQ",
    "http://169.254.169.254/latest/meta-data",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=abcdefghijk",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@channel",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "https://www.youtube.com/watch?v=dQw4w9WgXc%2F",
    "https://youtube.com/watch?v=" + "a" * 3000,
]


@pytest.mark.parametrize("url,video_id", VALID)
def test_valid_urls_are_canonicalised(url, video_id):
    vid, canonical = normalize_url(url)
    assert vid == video_id
    assert canonical == f"https://www.youtube.com/watch?v={video_id}"


@pytest.mark.parametrize("url", INVALID)
def test_invalid_urls_are_rejected(url):
    with pytest.raises(ApiError) as info:
        normalize_url(url)
    assert info.value.status_code == 400
    assert info.value.code in {"invalid_url", "unsupported_url"}
