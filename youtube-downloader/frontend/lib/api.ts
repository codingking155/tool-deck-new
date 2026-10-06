import { filenameFromDisposition } from "./format";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export type DownloadType = "video" | "audio";

export interface VideoFormat {
  /** Opaque option key chosen by the server, e.g. "video-1080" or "audio-mp3". */
  format_id: string;
  type: DownloadType;
  label: string;
  resolution: string | null;
  extension: string;
  note?: string | null;
  filesize?: number | null;
}

export interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channel: string;
  duration: number | null;
  formats: VideoFormat[];
}

export type JobStatus = "queued" | "downloading" | "processing" | "ready" | "error" | "cancelled";

export interface DownloadJob {
  id: string;
  status: JobStatus;
  progress: number | null;
  message: string | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed: number | null;
  eta: number | null;
  error: { code: string; detail: string } | null;
  filename: string | null;
  filesize: number | null;
  download_type: DownloadType;
  format_id: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE_MESSAGE = "We can't reach the download server. Check your connection, or make sure the backend is running.";

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE_MESSAGE, "backend_unavailable");
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const data = (await response.json().catch(() => null)) as { detail?: unknown; code?: unknown } | null;
  const detail = typeof data?.detail === "string" ? data.detail : null;
  const code = typeof data?.code === "string" ? data.code : `http_${response.status}`;
  if (detail) return new ApiError(detail, code, response.status);
  if (response.status === 429) {
    return new ApiError("Too many requests. Please wait a moment and try again.", "rate_limited", 429);
  }
  if (response.status >= 500) return new ApiError(OFFLINE_MESSAGE, "backend_unavailable", response.status);
  return new ApiError("Something went wrong. Please try again.", code, response.status);
}

export async function getVideoInfo(url: string, signal?: AbortSignal): Promise<VideoInfo> {
  const response = await request(`/api/info?url=${encodeURIComponent(url)}`, { signal });
  return (await response.json()) as VideoInfo;
}

const jsonInit = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

/** One-shot download: the server responds once the file is ready (no progress). */
export async function downloadVideo(
  url: string,
  formatId?: string,
  downloadType: DownloadType = "video",
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await request(
    "/api/download",
    jsonInit({ url, format_id: formatId, download_type: downloadType }, signal),
  );
  return response.blob();
}

export async function createJob(
  url: string,
  formatId: string,
  downloadType: DownloadType,
  signal?: AbortSignal,
): Promise<DownloadJob> {
  const response = await request("/api/jobs", jsonInit({ url, format_id: formatId, download_type: downloadType }, signal));
  return (await response.json()) as DownloadJob;
}

export async function getJob(id: string, signal?: AbortSignal): Promise<DownloadJob> {
  const response = await request(`/api/jobs/${encodeURIComponent(id)}`, { signal });
  return (await response.json()) as DownloadJob;
}

export async function cancelJob(id: string): Promise<void> {
  await request(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
}

export interface FileTransfer {
  blob: Blob;
  filename: string | null;
}

/** Fetch a finished job's file, reporting transfer progress (0..1) when the size is known. */
export async function fetchJobFile(
  id: string,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<FileTransfer> {
  const response = await request(`/api/jobs/${encodeURIComponent(id)}/file`, { signal });
  const header = response.headers.get("content-length");
  const total = header ? Number(header) || null : null;
  const type = response.headers.get("content-type") ?? "application/octet-stream";
  const disposition = response.headers.get("content-disposition");

  const filename = filenameFromDisposition(disposition);

  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, blob.size);
    return { blob, filename };
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
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
