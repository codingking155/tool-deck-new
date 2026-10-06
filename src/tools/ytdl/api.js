/* Client for the YouTube Downloader backend (youtube-downloader/backend, hosted on Render).
   VITE_DOWNLOADER_API_URL is public by design: it's just the service's base URL. */
import { filenameFromDisposition } from "./core.js";

const BASE = (import.meta.env?.VITE_DOWNLOADER_API_URL || "").replace(/\/+$/, "");

export const isConfigured = () => !!BASE;

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

/** Stream a finished job's file into a Blob, reporting (loaded, total|null). */
export async function fetchJobFile(id, onProgress, signal) {
  const res = await request(`/api/jobs/${encodeURIComponent(id)}/file`, { signal });
  const total = Number(res.headers.get("content-length")) || null;
  const type = res.headers.get("content-type") || "application/octet-stream";
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));
  if (!res.body) {
    const blob = await res.blob();
    onProgress(blob.size, blob.size);
    return { blob, filename };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return { blob: new Blob(chunks, { type }), filename };
}
