"""FastAPI entry point.

Endpoints
---------
GET    /api/health              liveness + FFmpeg availability
GET    /api/info?url=...        metadata and download options
POST   /api/jobs                start a download job (used by the web app, reports progress)
GET    /api/jobs/{id}           job status / progress
GET    /api/jobs/{id}/file      fetch the finished file (deleted from the server afterwards)
DELETE /api/jobs/{id}           cancel a job or discard its file
POST   /api/download            one-shot synchronous download (simple API clients)
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config import settings
from downloader import OPTION_ID_RE, ffmpeg_available, get_video_info
from errors import ApiError
from jobs import Job, JobManager, reset_download_dir
from ratelimit import RateLimiter
from validation import MAX_URL_LENGTH, normalize_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("downloader")

JOB_ID_PATTERN = r"^[0-9a-f]{32}$"
MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
}

jobs = JobManager()
info_limiter = RateLimiter(settings.info_rate_limit)
download_limiter = RateLimiter(settings.download_rate_limit)


def _sweeper(stop: threading.Event) -> None:
    while not stop.wait(settings.sweep_interval_seconds):
        try:
            jobs.sweep()
        except Exception:
            logger.exception("Cleanup sweep failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    reset_download_dir()
    if not ffmpeg_available():
        logger.warning("FFmpeg/ffprobe not found: merged video and MP3/M4A downloads will be refused.")
    stop = threading.Event()
    thread = threading.Thread(target=_sweeper, args=(stop,), name="cleanup", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        jobs.shutdown()


app = FastAPI(title="Video Downloader API", version="1.0.0", lifespan=lifespan)


# --------------------------------------------------------------------------- middleware


class BodySizeLimitMiddleware:
    """Reject request bodies larger than ``max_bytes`` (declared or streamed)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        too_large = JSONResponse(status_code=413, content={"code": "too_large", "detail": "Request body is too large."})
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = self.max_bytes + 1
                if declared > self.max_bytes:
                    await too_large(scope, receive, send)
                    return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise ApiError(413, "too_large", "Request body is too large.")
            return message

        await self.app(scope, limited_receive, send)


app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition", "Content-Length"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


# --------------------------------------------------------------------------- errors


def _error_response(error: ApiError) -> JSONResponse:
    headers = {}
    retry_after = getattr(error, "retry_after", None)
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(status_code=error.status_code, content=error.to_dict(), headers=headers)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return _error_response(exc)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = {".".join(str(p) for p in err.get("loc", ())[1:]) for err in exc.errors()}
    if "url" in fields:
        return _error_response(ApiError(400, "invalid_url", "Please provide a valid YouTube link."))
    if "download_type" in fields:
        return _error_response(ApiError(400, "invalid_request", "Invalid download type."))
    return _error_response(ApiError(400, "invalid_request", "The request was malformed."))


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return _error_response(ApiError(500, "server_error", "Something went wrong on our side. Please try again."))


# --------------------------------------------------------------------------- helpers


def client_key(request: Request) -> str:
    """Rate-limit identity. Behind N trusted proxies, the client is the Nth entry from the
    right of X-Forwarded-For; anything further left is client-supplied and ignored."""
    hops = settings.trusted_proxy_hops
    if hops > 0:
        entries = [e.strip() for e in request.headers.get("x-forwarded-for", "").split(",") if e.strip()]
        if len(entries) >= hops:
            return entries[-hops]
    return request.client.host if request.client else "unknown"


class DownloadRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=MAX_URL_LENGTH)
    format_id: str | None = Field(default=None, max_length=32)
    download_type: Literal["video", "audio"] = "video"


def _resolve_format(payload: DownloadRequest) -> str:
    format_id = payload.format_id or ("audio-best" if payload.download_type == "audio" else "video-best")
    if not OPTION_ID_RE.fullmatch(format_id) or not format_id.startswith(payload.download_type + "-"):
        raise ApiError(422, "format_unavailable", "That format isn't available for this video. Pick another one.")
    return format_id


def _file_response(job: Job) -> FileResponse:
    assert job.file_path is not None and job.filename is not None
    return FileResponse(
        path=str(job.file_path),
        filename=job.filename,
        media_type=MEDIA_TYPES.get(job.file_path.suffix.lower(), "application/octet-stream"),
        # One download per job: the file is removed as soon as it has been sent.
        background=BackgroundTask(jobs.discard, job.id),
    )


def _get_job(job_id: str) -> Job:
    job = jobs.store.get(job_id)
    if job is None:
        raise ApiError(404, "job_not_found", "This download has expired. Please start it again.")
    return job


# --------------------------------------------------------------------------- routes


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"status": "ok", "ffmpeg": ffmpeg_available()}


@app.get("/api/info")
def info(request: Request, url: str = Query(..., min_length=1, max_length=MAX_URL_LENGTH)) -> dict[str, object]:
    _, canonical = normalize_url(url)
    info_limiter.check(client_key(request))
    return get_video_info(canonical)


@app.post("/api/jobs", status_code=202)
def create_job(payload: DownloadRequest, request: Request) -> dict[str, object]:
    _, canonical = normalize_url(payload.url)
    format_id = _resolve_format(payload)
    client = client_key(request)
    download_limiter.check(client)
    job = jobs.create(url=canonical, format_id=format_id, download_type=payload.download_type, client=client)
    jobs.submit(job)
    return job.public()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str = PathParam(..., pattern=JOB_ID_PATTERN)) -> dict[str, object]:
    return _get_job(job_id).public()


@app.get("/api/jobs/{job_id}/file")
def job_file(job_id: str = PathParam(..., pattern=JOB_ID_PATTERN)) -> FileResponse:
    job = _get_job(job_id)
    if job.status != "ready" or job.file_path is None or not job.file_path.exists():
        raise ApiError(409, "not_ready", "This download isn't ready yet.")
    return _file_response(job)


@app.delete("/api/jobs/{job_id}", status_code=204)
def cancel_job(job_id: str = PathParam(..., pattern=JOB_ID_PATTERN)) -> Response:
    jobs.cancel(job_id)
    return Response(status_code=204)


@app.post("/api/download")
def download(payload: DownloadRequest, request: Request) -> FileResponse:
    """Synchronous variant: blocks until the file is ready, then streams it."""
    _, canonical = normalize_url(payload.url)
    format_id = _resolve_format(payload)
    client = client_key(request)
    download_limiter.check(client)
    job = jobs.create(url=canonical, format_id=format_id, download_type=payload.download_type, client=client)
    jobs.run(job.id)
    if job.status != "ready":
        jobs.discard(job.id)
        raise ApiError(job.error_status or 500, job.error_code or "download_failed", job.error or "The download failed.")
    return _file_response(job)
