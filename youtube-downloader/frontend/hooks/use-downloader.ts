"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";

import {
  ApiError,
  cancelJob,
  createJob,
  fetchJobFile,
  getJob,
  getVideoInfo,
  type DownloadJob,
  type DownloadType,
  type VideoFormat,
  type VideoInfo,
} from "@/lib/api";
import { formatBytes, safeDownloadName, sanitizeFilename } from "@/lib/format";
import { checkYouTubeUrl } from "@/lib/youtube";

/**
 * IDLE → ANALYZING → VIDEO_READY → DOWNLOADING → COMPLETE, with ERROR reachable from
 * analysis and download. Downloads run as server jobs: we poll the job for progress,
 * then stream the finished file into a Blob and hand it to the browser.
 */
export type Phase = "idle" | "analyzing" | "ready" | "downloading" | "complete" | "error";

export type DownloadStage = "queued" | "downloading" | "processing" | "saving";

export interface DownloadProgress {
  stage: DownloadStage;
  /** 0..1, or null when the size is unknown (indeterminate). */
  value: number | null;
  message: string | null;
  loaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
}

export interface DownloaderError {
  message: string;
  code: string;
  during: "analyze" | "download";
}

export interface DownloaderState {
  phase: Phase;
  url: string | null;
  video: VideoInfo | null;
  mode: DownloadType;
  formatId: string | null;
  progress: DownloadProgress | null;
  error: DownloaderError | null;
  result: { filename: string; size: number } | null;
}

type Action =
  | { type: "analyze"; url: string }
  | { type: "analyzed"; video: VideoInfo; mode: DownloadType; formatId: string | null }
  | { type: "mode"; mode: DownloadType; formatId: string | null }
  | { type: "format"; formatId: string }
  | { type: "download" }
  | { type: "progress"; progress: DownloadProgress }
  | { type: "complete"; filename: string; size: number }
  | { type: "fail"; error: DownloaderError }
  | { type: "back-to-ready" }
  | { type: "reset" };

const initialState: DownloaderState = {
  phase: "idle",
  url: null,
  video: null,
  mode: "video",
  formatId: null,
  progress: null,
  error: null,
  result: null,
};

function reducer(state: DownloaderState, action: Action): DownloaderState {
  switch (action.type) {
    case "analyze":
      return { ...initialState, mode: state.mode, phase: "analyzing", url: action.url };
    case "analyzed":
      return { ...state, phase: "ready", video: action.video, mode: action.mode, formatId: action.formatId };
    case "mode":
      return { ...state, mode: action.mode, formatId: action.formatId, error: null, result: null, phase: "ready" };
    case "format":
      return { ...state, formatId: action.formatId, error: null, result: null, phase: "ready" };
    case "download":
      return {
        ...state,
        phase: "downloading",
        error: null,
        result: null,
        progress: { stage: "queued", value: null, message: "Starting", loaded: null, total: null, speed: null, eta: null },
      };
    case "progress":
      return state.phase === "downloading" ? { ...state, progress: action.progress } : state;
    case "complete":
      return { ...state, phase: "complete", progress: null, result: { filename: action.filename, size: action.size } };
    case "fail":
      return { ...state, phase: "error", progress: null, error: action.error };
    case "back-to-ready":
      return { ...state, phase: state.video ? "ready" : "idle", progress: null, error: null };
    case "reset":
      return { ...initialState, mode: state.mode };
  }
}

const VIDEO_PREFERENCE = ["video-1080", "video-best"];
const AUDIO_PREFERENCE = ["audio-mp3", "audio-m4a", "audio-best"];

export function formatsFor(video: VideoInfo | null, mode: DownloadType): VideoFormat[] {
  return video?.formats.filter((f) => f.type === mode) ?? [];
}

function defaultFormat(video: VideoInfo, mode: DownloadType): string | null {
  const available = formatsFor(video, mode);
  const preference = mode === "video" ? VIDEO_PREFERENCE : AUDIO_PREFERENCE;
  return preference.find((id) => available.some((f) => f.format_id === id)) ?? available[0]?.format_id ?? null;
}

function toError(error: unknown, during: DownloaderError["during"]): DownloaderError {
  if (error instanceof ApiError) return { message: error.message, code: error.code, during };
  return { message: "Something unexpected happened. Please try again.", code: "unknown", during };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function jobProgress(job: DownloadJob): DownloadProgress {
  const stage: DownloadStage =
    job.status === "processing" ? "processing" : job.status === "queued" ? "queued" : "downloading";
  return {
    stage,
    value: stage === "downloading" && job.total_bytes ? (job.progress ?? 0) : null,
    message: job.message,
    loaded: job.downloaded_bytes,
    total: job.total_bytes,
    speed: job.speed,
    eta: job.eta,
  };
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start reading the blob before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

const POLL_INTERVAL_MS = 600;

export function useDownloader() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const analyzeAbort = useRef<AbortController | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const cancelledByUser = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Abort in-flight work and release the server job if the page goes away.
  useEffect(
    () => () => {
      analyzeAbort.current?.abort();
      downloadAbort.current?.abort();
      if (jobId.current) void cancelJob(jobId.current);
    },
    [],
  );

  const analyze = useCallback(async (raw: string): Promise<boolean> => {
    const check = checkYouTubeUrl(raw);
    if (!check.ok) return false;
    if (stateRef.current.phase === "downloading") return false;

    analyzeAbort.current?.abort();
    const controller = new AbortController();
    analyzeAbort.current = controller;
    dispatch({ type: "analyze", url: check.url });

    try {
      const video = await getVideoInfo(check.url, controller.signal);
      if (controller.signal.aborted) return true;
      const preferred = stateRef.current.mode;
      const mode: DownloadType = formatsFor(video, preferred).length ? preferred : preferred === "video" ? "audio" : "video";
      dispatch({ type: "analyzed", video, mode, formatId: defaultFormat(video, mode) });
    } catch (error) {
      if (isAbort(error)) return true;
      dispatch({ type: "fail", error: toError(error, "analyze") });
    } finally {
      if (analyzeAbort.current === controller) analyzeAbort.current = null;
    }
    return true;
  }, []);

  const setMode = useCallback((mode: DownloadType) => {
    const { video, phase } = stateRef.current;
    if (!video || phase === "downloading") return;
    dispatch({ type: "mode", mode, formatId: defaultFormat(video, mode) });
  }, []);

  const setFormat = useCallback((formatId: string) => {
    if (stateRef.current.phase === "downloading") return;
    dispatch({ type: "format", formatId });
  }, []);

  const download = useCallback(async () => {
    const { url, video, formatId, mode, phase } = stateRef.current;
    if (!url || !video || !formatId || phase === "downloading") return;
    const format = video.formats.find((f) => f.format_id === formatId);

    const controller = new AbortController();
    downloadAbort.current = controller;
    cancelledByUser.current = false;
    dispatch({ type: "download" });

    try {
      let job = await createJob(url, formatId, mode, controller.signal);
      jobId.current = job.id;

      for (;;) {
        if (job.status === "ready") break;
        if (job.status === "error") {
          throw new ApiError(job.error?.detail ?? "The download failed.", job.error?.code ?? "download_failed");
        }
        if (job.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
        dispatch({ type: "progress", progress: jobProgress(job) });
        await sleep(POLL_INTERVAL_MS, controller.signal);
        job = await getJob(job.id, controller.signal);
      }

      let lastPaint = 0;
      const { blob, filename } = await fetchJobFile(
        job.id,
        (loaded, total) => {
          const now = performance.now();
          if (now - lastPaint < 100 && loaded !== total) return;
          lastPaint = now;
          dispatch({
            type: "progress",
            progress: {
              stage: "saving",
              value: total ? loaded / total : null,
              message: "Saving to your device",
              loaded,
              total,
              speed: null,
              eta: null,
            },
          });
        },
        controller.signal,
      );
      jobId.current = null; // the server deletes the file once it has been sent

      const extension = format?.extension ?? (mode === "audio" ? "mp3" : "mp4");
      const name = safeDownloadName(filename ?? `${sanitizeFilename(video.title)}.${extension}`, extension);
      saveBlob(blob, name);
      dispatch({ type: "complete", filename: name, size: blob.size });
      toast.success("Download complete", { description: `${name} · ${formatBytes(blob.size) ?? ""}`.replace(/ · $/, "") });
    } catch (error) {
      if (jobId.current) void cancelJob(jobId.current);
      jobId.current = null;
      if (isAbort(error)) {
        if (cancelledByUser.current) {
          dispatch({ type: "back-to-ready" });
          toast("Download cancelled");
        }
        return;
      }
      const failure = toError(error, "download");
      dispatch({ type: "fail", error: failure });
      toast.error("Download failed", { description: failure.message });
    } finally {
      if (downloadAbort.current === controller) downloadAbort.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledByUser.current = true;
    downloadAbort.current?.abort();
  }, []);

  const dismissError = useCallback(() => dispatch({ type: "back-to-ready" }), []);

  const reset = useCallback(() => {
    analyzeAbort.current?.abort();
    if (stateRef.current.phase === "downloading") cancel();
    dispatch({ type: "reset" });
  }, [cancel]);

  return { state, analyze, setMode, setFormat, download, cancel, dismissError, reset };
}
