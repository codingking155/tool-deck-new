"""Run the real API against the local fake YouTube (no network access needed).

    python -m tests.demo_server [--port 8000] [--throttle 400000]

Used for UI development and the frontend end-to-end check. Any 11-character video ID
works; the special IDs in ``tests/fake_youtube.py`` simulate failures. ``--throttle``
limits download speed (bytes/s) so progress is visible.
"""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--throttle", type=int, default=400_000)
    args = parser.parse_args()

    os.environ.setdefault("DOWNLOAD_DIR", str(Path(tempfile.gettempdir()) / "clipdeck-demo-downloads"))
    for key in ("no_proxy", "NO_PROXY"):
        os.environ[key] = ",".join(filter(None, [os.environ.get(key, ""), "127.0.0.1", "localhost"]))

    import uvicorn

    import downloader
    from tests import fake_youtube

    media = fake_youtube.make_media(Path(tempfile.gettempdir()) / "clipdeck-demo-media")
    base_url, _server = fake_youtube.serve(media)
    fake_youtube.install(None, base_url, media)

    base_options = downloader._base_options
    downloader._base_options = lambda: {**base_options(), "ratelimit": args.throttle, "http_chunk_size": 65536}

    from main import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
