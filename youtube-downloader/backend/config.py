"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name} must be an integer.") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # Dedicated scratch directory. Every job gets its own random sub-directory.
    download_dir: Path = field(default_factory=lambda: Path(os.getenv("DOWNLOAD_DIR", "downloads")).resolve())
    allowed_origins: list[str] = field(default_factory=lambda: _list("ALLOWED_ORIGINS", ["http://localhost:3000"]))
    # Files older than this are swept even if nobody fetched them.
    file_ttl_seconds: int = field(default_factory=lambda: _int("FILE_TTL_SECONDS", 30 * 60))
    sweep_interval_seconds: int = field(default_factory=lambda: _int("SWEEP_INTERVAL_SECONDS", 60))
    # Refuse very long videos and very large files.
    max_duration_seconds: int = field(default_factory=lambda: _int("MAX_DURATION_SECONDS", 3 * 60 * 60))
    max_filesize_bytes: int = field(default_factory=lambda: _int("MAX_FILESIZE_MB", 4096) * 1024 * 1024)
    # Concurrency and abuse limits.
    max_workers: int = field(default_factory=lambda: _int("MAX_CONCURRENT_DOWNLOADS", 2))
    max_queued_jobs: int = field(default_factory=lambda: _int("MAX_QUEUED_JOBS", 20))
    max_active_jobs_per_client: int = field(default_factory=lambda: _int("MAX_ACTIVE_JOBS_PER_CLIENT", 2))
    info_rate_limit: int = field(default_factory=lambda: _int("INFO_RATE_LIMIT_PER_MINUTE", 30))
    download_rate_limit: int = field(default_factory=lambda: _int("DOWNLOAD_RATE_LIMIT_PER_MINUTE", 6))
    max_body_bytes: int = field(default_factory=lambda: _int("MAX_BODY_BYTES", 4 * 1024))
    # Only enable behind a reverse proxy you control; otherwise clients could spoof their IP.
    trust_proxy_headers: bool = field(default_factory=lambda: _bool("TRUST_PROXY_HEADERS", False))
    socket_timeout: int = field(default_factory=lambda: _int("SOCKET_TIMEOUT_SECONDS", 20))


settings = Settings()
