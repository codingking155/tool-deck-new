import os
import sys
import tempfile
from pathlib import Path

# Configure before the app modules are imported (settings are read at import time).
_TMP = Path(tempfile.mkdtemp(prefix="ytdl-tests-"))
os.environ["DOWNLOAD_DIR"] = str(_TMP / "downloads")
os.environ["DOWNLOAD_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["INFO_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["MAX_ACTIVE_JOBS_PER_CLIENT"] = "5"
for key in ("no_proxy", "NO_PROXY"):
    os.environ[key] = ",".join(filter(None, [os.environ.get(key, ""), "127.0.0.1", "localhost"]))

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tests import fake_youtube  # noqa: E402


@pytest.fixture(scope="session")
def media_server():
    media = fake_youtube.make_media(_TMP / "media")
    base_url, server = fake_youtube.serve(media)
    yield base_url, media
    server.shutdown()


@pytest.fixture
def fake_yt(monkeypatch, media_server):
    base_url, media = media_server
    fake_youtube.install(monkeypatch, base_url, media)
    return base_url


@pytest.fixture
def client():
    import main

    main.info_limiter.reset()
    main.download_limiter.reset()
    with TestClient(main.app) as test_client:
        yield test_client
