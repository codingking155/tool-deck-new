"""Download jobs.

A job owns one random directory under ``settings.download_dir``. Jobs run on a bounded
thread pool and report progress into an in-memory ``JobStore``. The store is the seam for
scaling out later: swap it for a Redis-backed implementation and move ``_run`` into a
queue worker, and the HTTP layer stays the same.
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from config import settings
from downloader import DownloadCancelled, ProgressUpdate, download_video
from errors import ApiError

logger = logging.getLogger("downloader")

ACTIVE_STATES = {"queued", "downloading", "processing"}


@dataclass
class Job:
    id: str
    url: str
    format_id: str
    download_type: str
    client: str
    directory: Path
    status: str = "queued"  # queued | downloading | processing | ready | error | cancelled
    progress: float | None = 0.0
    message: str | None = "Waiting in queue"
    downloaded_bytes: int | None = None
    total_bytes: int | None = None
    speed: float | None = None
    eta: int | None = None
    error_code: str | None = None
    error_status: int | None = None
    error: str | None = None
    file_path: Path | None = None
    filename: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_requested: bool = False

    def public(self) -> dict[str, Any]:
        size = None
        if self.file_path is not None and self.file_path.exists():
            size = self.file_path.stat().st_size
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "speed": self.speed,
            "eta": self.eta,
            "error": {"code": self.error_code, "detail": self.error} if self.error else None,
            "filename": self.filename,
            "filesize": size,
            "download_type": self.download_type,
            "format_id": self.format_id,
        }


class JobStore:
    """Thread-safe in-memory job registry."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **changes: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = time.time()

    def remove(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.pop(job_id, None)

    def all(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())

    def count_active(self, client: str | None = None) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.status in ACTIVE_STATES and (client is None or j.client == client))


class JobManager:
    def __init__(self, store: JobStore | None = None) -> None:
        self.store = store or JobStore()
        self._executor: ThreadPoolExecutor | None = None
        self._admission = threading.Lock()

    # ---- lifecycle -----------------------------------------------------------------

    def create(self, *, url: str, format_id: str, download_type: str, client: str) -> Job:
        with self._admission:
            if self.store.count_active(client) >= settings.max_active_jobs_per_client:
                raise ApiError(429, "too_many_jobs", "You already have downloads in progress. Let them finish first.")
            if self.store.count_active() >= settings.max_queued_jobs:
                raise ApiError(503, "busy", "The server is busy right now. Please try again in a minute.")
            job_id = uuid.uuid4().hex
            job = Job(
                id=job_id,
                url=url,
                format_id=format_id,
                download_type=download_type,
                client=client,
                directory=settings.download_dir / job_id,
            )
            self.store.add(job)
        return job

    def submit(self, job: Job) -> None:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=settings.max_workers, thread_name_prefix="download")
        self._executor.submit(self.run, job.id)

    def run(self, job_id: str) -> Job:
        """Execute a job synchronously on the calling thread and return its final state."""
        job = self.store.get(job_id)
        if job is None:
            raise ApiError(404, "job_not_found", "This download no longer exists.")
        if job.cancel_requested:
            self._finish_cancelled(job)
            return job

        def on_progress(update: ProgressUpdate) -> None:
            changes: dict[str, Any] = {"status": update.stage, "progress": update.progress}
            if update.stage == "downloading":
                changes.update(
                    message=update.message or "Downloading",
                    downloaded_bytes=update.downloaded_bytes,
                    total_bytes=update.total_bytes,
                    speed=update.speed,
                    eta=update.eta,
                )
            else:
                changes.update(message=update.message or "Processing", speed=None, eta=None)
            self.store.update(job_id, **changes)

        self.store.update(job_id, status="downloading", progress=0.0, message="Connecting to YouTube")
        try:
            result = download_video(
                job.url,
                job.format_id,
                job.directory,
                on_progress=on_progress,
                is_cancelled=lambda: job.cancel_requested,
            )
        except DownloadCancelled:
            self._finish_cancelled(job)
        except ApiError as exc:
            self.store.update(
                job_id,
                status="error",
                error_code=exc.code,
                error_status=exc.status_code,
                error=exc.message,
                message=None,
                speed=None,
                eta=None,
            )
            remove_dir(job.directory)
        except Exception:
            logger.exception("Unexpected failure in job %s", job_id)
            self.store.update(
                job_id,
                status="error",
                error_code="download_failed",
                error_status=500,
                error="The download failed unexpectedly. Please try again.",
                message=None,
            )
            remove_dir(job.directory)
        else:
            self.store.update(
                job_id,
                status="ready",
                progress=1.0,
                message="Ready",
                file_path=result.path,
                filename=result.filename,
                speed=None,
                eta=None,
            )
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self.store.get(job_id)
        if job is None:
            return None
        if job.status in ACTIVE_STATES:
            # The running download notices the flag at its next progress callback.
            self.store.update(job_id, cancel_requested=True, message="Cancelling")
        else:
            self.discard(job_id)
        return job

    def _finish_cancelled(self, job: Job) -> None:
        self.store.update(job.id, status="cancelled", message="Cancelled", speed=None, eta=None)
        remove_dir(job.directory)

    def discard(self, job_id: str) -> None:
        job = self.store.remove(job_id)
        if job is not None:
            remove_dir(job.directory)

    # ---- cleanup -------------------------------------------------------------------

    def sweep(self, now: float | None = None) -> int:
        """Forget finished jobs and delete files older than the TTL. Returns jobs removed."""
        now = now or time.time()
        removed = 0
        for job in self.store.all():
            if job.status not in ACTIVE_STATES and now - job.updated_at > settings.file_ttl_seconds:
                self.discard(job.id)
                removed += 1
        # Orphaned directories (e.g. from a crash) that no job owns.
        known = {job.directory for job in self.store.all()}
        if settings.download_dir.exists():
            for entry in settings.download_dir.iterdir():
                if entry in known:
                    continue
                try:
                    age = now - entry.stat().st_mtime
                except FileNotFoundError:
                    continue
                if age > settings.file_ttl_seconds:
                    remove_dir(entry)
        return removed

    def shutdown(self) -> None:
        for job in self.store.all():
            job.cancel_requested = True
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None


def remove_dir(path: Path) -> None:
    """Delete a job directory, refusing anything outside the download root."""
    try:
        resolved = path.resolve()
        root = settings.download_dir.resolve()
    except OSError:
        return
    if resolved == root or root not in resolved.parents:
        logger.error("Refusing to delete %s outside %s", resolved, root)
        return
    if resolved.is_dir():
        shutil.rmtree(resolved, ignore_errors=True)
    elif resolved.exists():
        resolved.unlink(missing_ok=True)


def reset_download_dir() -> None:
    """Called on startup: nothing in the scratch directory survives a restart."""
    root = settings.download_dir
    root.mkdir(parents=True, exist_ok=True)
    for entry in root.iterdir():
        remove_dir(entry)
