/* Client for the YouTube Downloader backend (youtube-downloader/backend, hosted on Render).
   VITE_DOWNLOADER_API_URL is public by design: it's just the service's base URL. */
const BASE = (import.meta.env?.VITE_DOWNLOADER_API_URL || "").replace(/\/+$/, "");

export const isConfigured = () => !!BASE;

/* Render's free tier sleeps when idle and takes up to a minute to wake. Any answer from the
   server means it's up; the UI uses this to explain a slow first lookup honestly. */
let awake = false;
let waking = null;
export const isAwake = () => awake;

/** Fire-and-forget /api/health on tool mount so the server is (hopefully) up by the time it's needed. */
export function wakeBackend() {
  if (!BASE || awake || waking) return;
  waking = fetch(`${BASE}/api/health`, { cache: "no-store", signal: AbortSignal.timeout?.(90_000) })
    .then((r) => { if (r.ok) awake = true; })
    .catch(() => undefined)
    .finally(() => { waking = null; });
}

export class DownloaderError extends Error {
  constructor(message, code, status = 0) { super(message); this.name = "DownloaderError"; this.code = code; this.status = status; }
}

const OFFLINE = "We can't reach the download service right now. Check your connection and try again in a minute.";

async function request(path, init = {}) {
  if (!BASE) throw new DownloaderError("The YouTube downloader isn't configured on this deployment.", "not_configured");
  let res;
  try { res = await fetch(`${BASE}${path}`, { ...init, cache: "no-store" }); }
  catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new DownloaderError(OFFLINE, "backend_unavailable");
  }
  if (res.status < 500) awake = true;   // a 5xx may be Render's proxy, not our app
  if (res.ok) return res;
  const data = await res.json().catch(() => null);
  if (typeof data?.detail === "string") throw new DownloaderError(data.detail, data.code || `http_${res.status}`, res.status);
  if (res.status === 429) throw new DownloaderError("Too many requests. Please wait a moment and try again.", "rate_limited", 429);
  throw new DownloaderError(res.status >= 500 ? OFFLINE : "Something went wrong. Please try again.", res.status >= 500 ? "backend_unavailable" : `http_${res.status}`, res.status);
}

const post = (body, signal) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

export async function getVideoInfo(url, signal) {
  return (await request(`/api/info?url=${encodeURIComponent(url)}`, { signal })).json();
}

export async function createJob(url, formatId, type, signal) {
  return (await request("/api/jobs", post({ url, format_id: formatId, download_type: type }, signal))).json();
}

export async function getJob(id, signal) {
  return (await request(`/api/jobs/${encodeURIComponent(id)}`, { signal })).json();
}

export function cancelJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
}

/** URL of a finished job's file. The page navigates to it and the server's
    Content-Disposition: attachment hands it to the browser's download manager,
    so a file of up to 1 GB is streamed to disk instead of buffered in a Blob
    (which ran phones out of memory). */
export function jobFileUrl(id) {
  if (!BASE) throw new DownloaderError("The YouTube downloader isn't configured on this deployment.", "not_configured");
  return `${BASE}/api/jobs/${encodeURIComponent(id)}/file`;
}
