FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DOWNLOAD_DIR=/tmp/clipdeck-downloads

# FFmpeg merges separate video/audio streams and converts audio to MP3/M4A.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY *.py ./

# Run as an unprivileged user; it only needs to write to DOWNLOAD_DIR.
RUN useradd --system --uid 10001 --home-dir /app app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"
# No --proxy-headers: client IPs come from TRUSTED_PROXY_HOPS (see config.py), which can't be spoofed.
# PORT is set by hosts such as Render; defaults to 8000.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --no-proxy-headers"]
