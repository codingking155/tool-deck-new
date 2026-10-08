import shutil
import subprocess
import time

import pytest

from config import settings

VIDEO = "https://youtu.be/abcdefghijk"


def wait_for(client, job_id, timeout=60):
    deadline = time.time() + timeout
    seen = []
    while time.time() < deadline:
        status = client.get(f"/api/jobs/{job_id}").json()
        seen.append(status)
        if status["status"] in {"ready", "error", "cancelled"}:
            return status, seen
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish: {seen[-1]}")


def probe(path):
    out = subprocess.run(
        [shutil.which("ffprobe"), "-v", "error", "-show_entries", "stream=codec_type,height", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return sorted(line.strip() for line in out.splitlines() if line.strip())


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["ffmpeg"] is True


def test_info_returns_metadata_and_options(client, fake_yt):
    response = client.get("/api/info", params={"url": VIDEO})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == "abcdefghijk"
    assert body["channel"] == "Test Channel"
    assert body["duration"] == 2
    # Only the safe ytimg host survives, the "evil.internal" thumbnail is dropped.
    assert body["thumbnail"].startswith("https://i.ytimg.com/")
    ids = [f["format_id"] for f in body["formats"]]
    assert ids == ["video-best", "video-1080", "video-720", "video-360", "audio-best", "audio-mp3", "audio-m4a"]
    assert all(f["filesize"] for f in body["formats"])


@pytest.mark.parametrize(
    "url",
    ["https://vimeo.com/1", "http://169.254.169.254/latest", "https://www.youtube.com/playlist?list=x", "nonsense"],
)
def test_info_rejects_unsupported_urls(client, url):
    response = client.get("/api/info", params={"url": url})
    assert response.status_code == 400
    assert response.json()["code"] in {"invalid_url", "unsupported_url"}


@pytest.mark.parametrize(
    "video_id,status,code",
    [
        ("privateVid0", 403, "private"),
        ("geoBlocked0", 451, "region_restricted"),
        ("deletedVid0", 404, "unavailable"),
        ("rateLimit00", 429, "rate_limited"),
        ("botCheck000", 503, "bot_check"),
        ("liveStream0", 422, "live"),
    ],
)
def test_info_maps_failures_to_friendly_errors(client, fake_yt, video_id, status, code):
    response = client.get("/api/info", params={"url": f"https://www.youtube.com/watch?v={video_id}"})
    assert response.status_code == status
    body = response.json()
    assert body["code"] == code
    assert "ERROR" not in body["detail"] and "Traceback" not in body["detail"]


@pytest.mark.parametrize(
    "format_id,download_type,suffix,streams",
    [
        ("video-720", "video", ".mp4", ["audio", "video,720"]),
        ("video-best", "video", ".mp4", ["audio", "video,1080"]),
        ("audio-mp3", "audio", ".mp3", ["audio"]),
        ("audio-m4a", "audio", ".m4a", ["audio"]),
        ("audio-best", "audio", ".m4a", ["audio"]),
    ],
)
def test_job_flow_downloads_merges_and_cleans_up(client, fake_yt, format_id, download_type, suffix, streams, tmp_path):
    created = client.post("/api/jobs", json={"url": VIDEO, "format_id": format_id, "download_type": download_type})
    assert created.status_code == 202, created.text
    job_id = created.json()["id"]

    final, history = wait_for(client, job_id)
    assert final["status"] == "ready", final
    assert final["progress"] == 1.0
    assert final["filename"] == f"Test clip Sample demo 1080p{suffix}"
    progress = [s["progress"] for s in history if s["progress"] is not None]
    assert progress == sorted(progress), "progress must never move backwards"

    file_response = client.get(f"/api/jobs/{job_id}/file")
    assert file_response.status_code == 200
    assert "attachment" in file_response.headers["content-disposition"]
    out = tmp_path / f"out{suffix}"
    out.write_bytes(file_response.content)
    assert probe(out) == streams

    # The file is deleted once delivered, and the job is forgotten.
    assert not (settings.download_dir / job_id).exists()
    assert client.get(f"/api/jobs/{job_id}").status_code == 404


def test_sync_download_endpoint(client, fake_yt):
    response = client.post("/api/download", json={"url": VIDEO, "format_id": "video-360", "download_type": "video"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "video/mp4"
    assert len(response.content) > 1000
    assert list(settings.download_dir.iterdir()) == []


def test_sync_download_reports_friendly_error(client, fake_yt):
    response = client.post("/api/download", json={"url": "https://youtu.be/privateVid0", "download_type": "video"})
    assert response.status_code == 403
    assert response.json()["code"] == "private"


@pytest.mark.parametrize(
    "payload,code",
    [
        ({"url": VIDEO, "format_id": "audio-mp3", "download_type": "video"}, "format_unavailable"),
        ({"url": VIDEO, "format_id": "137+bestaudio --exec rm", "download_type": "video"}, "format_unavailable"),
        ({"url": VIDEO, "format_id": "video-999", "download_type": "video"}, "format_unavailable"),
        ({"url": VIDEO, "download_type": "playlist"}, "invalid_request"),
        ({"url": "https://evil.com/x"}, "unsupported_url"),
    ],
)
def test_download_rejects_bad_requests(client, payload, code):
    response = client.post("/api/jobs", json=payload)
    assert response.status_code in {400, 422}
    assert response.json()["code"] == code


def test_body_size_limit(client):
    response = client.post("/api/jobs", content=b"{" + b" " * 10_000 + b"}", headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_rate_limit(client, monkeypatch):
    import main
    from ratelimit import RateLimiter

    monkeypatch.setattr(main, "info_limiter", RateLimiter(2))
    for _ in range(2):
        client.get("/api/info", params={"url": "https://vimeo.com/1"})  # rejected before counting
    statuses = [client.get("/api/info", params={"url": VIDEO}).status_code for _ in range(3)]
    assert statuses[-1] == 429
    limited = client.get("/api/info", params={"url": VIDEO})
    assert limited.json()["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1


def test_cancel_and_unknown_jobs(client, fake_yt):
    assert client.get("/api/jobs/" + "0" * 32).status_code == 404
    assert client.get("/api/jobs/../../etc/passwd").status_code == 404
    created = client.post("/api/jobs", json={"url": VIDEO, "format_id": "video-360", "download_type": "video"}).json()
    assert client.delete(f"/api/jobs/{created['id']}").status_code == 204
    final, _ = wait_for(client, created["id"])
    # Either the cancel landed first or the tiny file finished; both clean up properly.
    assert final["status"] in {"cancelled", "ready"}
    if final["status"] == "ready":
        client.delete(f"/api/jobs/{created['id']}")
    assert not (settings.download_dir / created["id"]).exists()


def test_sweep_removes_stale_files(client):
    import main

    orphan = settings.download_dir / "deadbeef"
    orphan.mkdir(parents=True)
    (orphan / "x.mp4").write_bytes(b"x")
    main.jobs.sweep(now=time.time() + settings.file_ttl_seconds + 5)
    assert not orphan.exists()


def test_client_key_ignores_spoofed_forwarded_for(monkeypatch):
    import dataclasses

    from starlette.requests import Request

    import main

    def request(xff):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "headers": headers, "client": ("10.0.0.9", 1234)})

    assert main.client_key(request("1.2.3.4")) == "10.0.0.9"  # hops=0: header ignored
    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, trusted_proxy_hops=1))
    assert main.client_key(request("6.6.6.6, 203.0.113.7")) == "203.0.113.7"  # spoofed left entry ignored
    assert main.client_key(request("")) == "10.0.0.9"
