# ClipDeck: YouTube video downloader

A clean web app for downloading YouTube videos and audio that **you own or have permission to download**.
Paste a link, see the thumbnail, title, channel and duration, pick any quality the video actually offers (up to 4K)
or extract MP3/M4A audio, and follow real progress until the file is saved.

- **Frontend:** Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · Lucide · Framer Motion · Sonner toasts
- **Backend:** Python · FastAPI · yt-dlp (Python API) · FFmpeg

> ClipDeck never bypasses DRM, sign-in, paywalls, members-only, age or region restrictions, or any other access
> control. If yt-dlp can't fetch a video anonymously, the user gets a clear error message instead.

```
youtube-downloader/
├── backend/
│   ├── main.py            FastAPI app: routes, CORS, body-size limit, error handlers
│   ├── downloader.py      yt-dlp integration: metadata, format options, downloads, progress
│   ├── jobs.py            Download jobs: bounded worker pool, in-memory store, cleanup sweeper
│   ├── validation.py      Strict YouTube URL validation and canonicalisation
│   ├── errors.py          Friendly, stable error codes (no raw tracebacks reach clients)
│   ├── ratelimit.py       Per-client sliding-window rate limiter
│   ├── config.py          Settings from environment variables
│   ├── tests/             pytest suite + a local fake YouTube (see "Testing")
│   └── Dockerfile
├── frontend/
│   ├── app/               layout, page, global styles/theme tokens
│   ├── components/        Navbar, DownloaderHero, URLInput, VideoPreview, FormatSelector,
│   │                      DownloadButton, DownloadProgress, FeatureCards, FAQ, Footer, ThemeToggle…
│   ├── components/ui/     shadcn/ui primitives (button, select, toggle-group, accordion, progress…)
│   ├── hooks/             use-downloader: the IDLE → ANALYZING → READY → DOWNLOADING → COMPLETE/ERROR state machine
│   ├── lib/               api client, URL checks, formatting helpers
│   └── Dockerfile
└── docker-compose.yml
```

## Requirements

- **Node.js** 20.9+ (22 recommended)
- **Python** 3.11+
- **FFmpeg** (with `ffprobe`) on the backend's `PATH`. It merges separate video/audio streams and converts audio.

### Installing FFmpeg

**macOS** (Homebrew):

```bash
brew install ffmpeg
```

**Ubuntu / Debian:**

```bash
sudo apt update && sudo apt install -y ffmpeg
```

**Windows:** pick one of the following:

```powershell
winget install --id Gyan.FFmpeg      # or
choco install ffmpeg                 # or
scoop install ffmpeg
```

You can also download a build from <https://www.gyan.dev/ffmpeg/builds/>, extract it, and add its `bin` folder to `PATH`.

Check it with `ffmpeg -version` and `ffprobe -version`. Without FFmpeg the app still runs, but any format that needs
merging or conversion returns a clear "FFmpeg isn't installed" error (`GET /api/health` reports `"ffmpeg": false`).

## Running locally

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # fastapi, uvicorn, yt-dlp, pydantic
uvicorn main:app --reload --port 8000
```

The API is now at <http://localhost:8000>, with interactive docs at <http://localhost:8000/docs>.

### Frontend

```bash
cd frontend
cp .env.example .env.local         # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Open <http://localhost:3000>.

`NEXT_PUBLIC_API_URL` is the URL the **browser** uses to reach the backend, and it is baked in at build time. The
backend only accepts browser requests from the origins listed in `ALLOWED_ORIGINS` (default `http://localhost:3000`).

### Docker

```bash
docker compose up --build
```

This starts the backend (with FFmpeg, running as a non-root user on a read-only filesystem with a tmpfs scratch
directory) on port 8000 and the frontend on port 3000. If you serve them from other hostnames, change
`NEXT_PUBLIC_API_URL` (frontend build arg) and `ALLOWED_ORIGINS` (backend env) in `docker-compose.yml`.

## API

All errors use the same shape, with a stable `code` you can branch on and a human-readable `detail`:

```json
{ "code": "region_restricted", "detail": "We couldn't access this video. Make sure the link is public and available in your region." }
```

### `GET /api/info?url={youtube_url}`

```json
{
  "id": "dQw4w9WgXcQ",
  "title": "…",
  "thumbnail": "https://i.ytimg.com/vi/…/maxresdefault.jpg",
  "channel": "…",
  "duration": 213,
  "formats": [
    { "format_id": "video-best", "type": "video", "label": "Best available", "resolution": "1080p", "extension": "mp4", "note": "Full HD", "filesize": 190840000 },
    { "format_id": "video-720",  "type": "video", "label": "720p", "resolution": "720p", "extension": "mp4", "note": "HD", "filesize": 61200000 },
    { "format_id": "audio-mp3",  "type": "audio", "label": "MP3", "resolution": "192 kbps", "extension": "mp3", "note": "Plays everywhere", "filesize": 5112000 }
  ]
}
```

`format_id` is an **option key chosen by the server**, not a raw yt-dlp format string:
`video-best`, `video-2160`, `video-1440`, `video-1080`, `video-720`, `video-480`, `video-360`, `audio-best`, `audio-mp3`
and `audio-m4a`. Only the qualities that the video actually reports are listed (vertical Shorts and letterboxed videos
are bucketed correctly). `filesize` is an estimate (video and merged audio) and may be `null`.

### `POST /api/download`

```json
{ "url": "https://youtu.be/…", "format_id": "video-1080", "download_type": "video" }
```

Blocks until the file is ready and then streams it as an attachment. This is handy for scripts, for example
`curl -OJ -X POST -H 'Content-Type: application/json' -d '{…}' http://localhost:8000/api/download`.

### Download jobs (used by the web app for live progress)

| Method & path | Purpose |
| --- | --- |
| `POST /api/jobs` | Same body as `/api/download`; returns `202` with a job (`id`, `status`, `progress`…) |
| `GET /api/jobs/{id}` | Status: `queued` → `downloading` (with `progress`, bytes, `speed`, `eta`) → `processing` (merging/converting) → `ready`, `error` or `cancelled` |
| `GET /api/jobs/{id}/file` | Fetch the finished file. It is deleted from the server once it has been sent. |
| `DELETE /api/jobs/{id}` | Cancel a running job or discard a finished one |
| `GET /api/health` | `{ "status": "ok", "ffmpeg": true }` |

The frontend polls the job, then streams the file into a `Blob` (showing transfer progress), triggers the browser
download through a temporary object URL with a sanitized filename, and revokes the URL afterwards.

## Security

- **Strict URL validation:** only `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/` (and `m.`, `music.`,
  `/live/`, `/embed/`) links with a valid 11-character ID are accepted. Credentials, odd ports, other hosts, playlists
  and look-alike domains are rejected.
- **No SSRF:** the server never passes the user's URL to yt-dlp. It rebuilds a canonical
  `https://www.youtube.com/watch?v=<id>` URL and restricts yt-dlp to the YouTube extractor (`allowed_extractors`), with
  `noplaylist` set. Thumbnails are only returned when they are HTTPS URLs on YouTube's image hosts.
- **No shell, no user-controlled options:** yt-dlp runs through its Python API with a fixed option set. Format option
  keys are matched against an allowlist and mapped to server-defined selectors. No cookies or credentials are used.
- **No user-controlled paths:** every job writes to `DOWNLOAD_DIR/<random uuid>/` with a fixed `%(id)s.%(ext)s`
  template. Deletion refuses anything outside `DOWNLOAD_DIR`. Download filenames are sanitized on both server and client.
- **Limits:** request body size (4 KB), URL length (2048), per-client rate limits for `/api/info` (30/min) and downloads
  (6/min), at most 2 active jobs per client, a bounded worker pool and queue, and maximum duration and file size.
- **Cleanup:** files are deleted right after they are sent and on failure or cancellation. A background sweeper removes
  anything older than `FILE_TTL_SECONDS` (30 min), and the scratch directory is emptied on startup.
- **Friendly errors:** yt-dlp and FFmpeg messages are mapped to codes such as `private`, `members_only`, `age_restricted`,
  `region_restricted`, `unavailable`, `rate_limited`, `bot_check`, `format_unavailable`, `ffmpeg_missing`, `processing_failed` and
  `network`. Raw output is only logged.
- **Headers:** the API sends `nosniff`, `no-referrer`, `DENY` and `no-store`. The frontend sends a CSP that only allows
  connections to itself and the API, plus YouTube's image CDN.

Behind a reverse proxy, set `TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`
(Render: `1`). The client is then read that many entries from the right, so a client can't spoof its IP by sending its
own header. Uvicorn's `--proxy-headers` is deliberately off.

## Configuration (backend environment)

| Variable | Default | |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `DOWNLOAD_DIR` | `downloads` | Scratch directory (emptied on start) |
| `FILE_TTL_SECONDS` | `1800` | Age at which unfetched files are swept |
| `MAX_DURATION_SECONDS` | `10800` | Longest video accepted |
| `MAX_FILESIZE_MB` | `4096` | Largest file yt-dlp will download |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | Worker threads |
| `MAX_QUEUED_JOBS` / `MAX_ACTIVE_JOBS_PER_CLIENT` | `20` / `2` | Admission limits |
| `INFO_RATE_LIMIT_PER_MINUTE` / `DOWNLOAD_RATE_LIMIT_PER_MINUTE` | `30` / `6` | Per-client rate limits |
| `MAX_BODY_BYTES` | `4096` | Request body limit |
| `TRUSTED_PROXY_HOPS` | `0` | Proxies in front of the app (Render: `1`); `0` uses the socket address |

## Testing

```bash
# Backend: lint and tests
cd backend
pip install -r requirements-dev.txt
ruff check . && pytest -q

# Frontend: lint, type-check and build
cd frontend
npm run lint && npm run typecheck && npm run build
```

The backend tests don't need internet access. `tests/fake_youtube.py` replaces only yt-dlp's extraction step with
tiny FFmpeg-generated clips served from a local HTTP server. Format selection, downloading, FFmpeg merging, MP3/M4A
conversion, progress hooks, cleanup and the HTTP API all run for real. Special video IDs simulate failures
(`privateVid0`, `geoBlocked0`, `deletedVid0`, `rateLimit00`, `liveStream0`).

The same fake can run the whole app offline, which is useful for UI work:

```bash
cd backend && python -m tests.demo_server --port 8000   # any youtu.be/<11 chars> link "works"
```

## Deploying with ToolDeck

In ToolDeck this is the **YouTube Video Downloader** tool (`/tool/ytdownloader`, `src/tools/YtDownloaderTool.jsx`).
The UI ships with the ToolDeck site on Vercel. This backend runs separately, because yt-dlp, FFmpeg and multi-minute
downloads don't fit Vercel functions or Supabase Edge Functions.

1. **Backend on Render.** In Render, choose *New → Blueprint* and pick this repository. It reads `render.yaml` at the
   repo root and creates the `tooldeck-ytdl` web service from `youtube-downloader/backend/Dockerfile`, with FFmpeg
   included. Check `ALLOWED_ORIGINS` there: it must list every origin the site is served from (the default is
   `https://tooldeck.in,https://www.tooldeck.in`; add Vercel preview URLs if you want the tool to work on previews).
2. **Point ToolDeck at it.** In the Vercel project settings, set `VITE_DOWNLOADER_API_URL` to the service URL (for
   example `https://tooldeck-ytdl.onrender.com`) and redeploy. Until it is set, the tool shows a "not connected" notice.
3. **CSP.** `vercel.json` already allows `https://*.onrender.com` in `connect-src` and YouTube's thumbnail hosts in
   `img-src`. If you put the backend on a custom domain, add that origin to `connect-src`.

Check it with `curl https://<service>.onrender.com/api/health`, which should return `{"status":"ok","ffmpeg":true}`.

**Caveats**
- YouTube often challenges requests from cloud/datacenter IPs ("Sign in to confirm you're not a bot"). The tool then
  shows a `bot_check` error saying YouTube is blocking the download server. That is YouTube's access control, and this project deliberately doesn't work around it
  (no cookies, no proxy rotation).
- The blueprint uses Render's **free** plan. It sleeps after about 15 minutes without traffic, so the next request
  waits about a minute while it wakes. With 512 MB of RAM and a fraction of a CPU, it is limited to one download at a
  time, files up to 1 GB and videos up to 1 hour. To lift the limits, change `plan:` and the `MAX_*` values in
  `render.yaml`.

## Extending it

The code is structured so you can scale it without rewriting the HTTP layer:

- **Job IDs and progress** already exist. To push progress instead of polling, add a Server-Sent Events endpoint that
  streams `Job.public()`.
- **Queue and Redis:** replace `JobStore` (in-memory) with a Redis-backed store, and run `JobManager.run` in a worker
  (RQ, Celery, Arq). The rate limiter has the same seam.
- **Object storage:** after `download_video` returns, upload the file to S3/R2 and redirect `/api/jobs/{id}/file` to a
  short-lived signed URL.
- **Accounts, history and quotas:** `Job.client` is the attribution point. Swap the IP for a user ID and persist jobs.

## Legal

Only download content you own, have permission to download, or that is licensed for downloading. Respect copyright
and YouTube's Terms of Service. This project is not affiliated with YouTube or Google.
