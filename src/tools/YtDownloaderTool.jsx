import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AlertTriangle, Check, ClipboardPaste, Download, Film, ImageOff, Loader2, Music2, RotateCcw, Search, X } from "lucide-react";
import {
  checkYouTubeUrl, defaultFormat, formatBytes, formatDuration, formatEta, formatLabel, formatsOf, safeDownloadName,
  sanitizeFilename, ERROR_TITLES, PERMANENT_ERRORS,
} from "./ytdl/core.js";
import { cancelJob, createJob, DownloaderError, fetchJobFile, getJob, getVideoInfo, isConfigured } from "./ytdl/api.js";

/* State machine: idle → analyzing → ready → downloading → complete, with error from analysis or download.
   Downloads run as server jobs: poll for progress, then stream the file into a Blob and save it. */
const initial = { phase: "idle", url: null, video: null, mode: "video", formatId: null, progress: null, error: null, result: null };

function reducer(s, a) {
  switch (a.type) {
    case "analyze": return { ...initial, mode: s.mode, phase: "analyzing", url: a.url };
    case "analyzed": return { ...s, phase: "ready", video: a.video, mode: a.mode, formatId: defaultFormat(a.video, a.mode) };
    case "mode": return { ...s, phase: "ready", mode: a.mode, formatId: defaultFormat(s.video, a.mode), error: null, result: null };
    case "format": return { ...s, phase: "ready", formatId: a.formatId, error: null, result: null };
    case "download": return { ...s, phase: "downloading", error: null, result: null, progress: { stage: "queued", value: null } };
    case "progress": return s.phase === "downloading" ? { ...s, progress: a.progress } : s;
    case "complete": return { ...s, phase: "complete", progress: null, result: a.result };
    case "fail": return { ...s, phase: "error", progress: null, error: a.error };
    case "back": return { ...s, phase: s.video ? "ready" : "idle", progress: null, error: null };
    case "reset": return { ...initial, mode: s.mode };
    default: return s;
  }
}

const isAbort = (e) => e?.name === "AbortError";
const toError = (e, during) => e instanceof DownloaderError
  ? { code: e.code, message: e.message, during }
  : { code: "unknown", message: "Something unexpected happened. Please try again.", during };

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);   // let the browser start reading the blob first
}

const STEPS = ["Fetch", "Process", "Save"];
const STEP_OF = { queued: 0, downloading: 0, processing: 1, saving: 2 };
const STAGE_TITLE = { queued: "Getting ready", downloading: "Downloading from YouTube", processing: "Processing", saving: "Saving to your device" };

function Progress({ progress, onCancel }) {
  const step = STEP_OF[progress.stage];
  const pct = progress.value == null ? null : Math.round(progress.value * 100);
  const title = progress.stage === "processing" && progress.message ? progress.message : STAGE_TITLE[progress.stage];
  const loaded = formatBytes(progress.loaded), total = formatBytes(progress.total);
  const speed = formatBytes(progress.speed);
  const details = [loaded && total ? `${loaded} of ${total}` : loaded, speed && `${speed}/s`, formatEta(progress.eta)].filter(Boolean);
  return (
    <div className="yd-progress">
      <ol className="yd-steps" aria-label="Download steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "on" : ""} aria-current={i === step ? "step" : undefined}>
            <span>{i < step ? <Check size={11} aria-hidden="true" /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>
      <div className="yd-ptitle" aria-live="polite"><b>{title}</b><span>{pct == null ? "" : `${pct}%`}</span></div>
      <div className={`yd-bar${pct == null ? " ind" : ""}`} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <i style={pct == null ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="yd-pfoot">
        <span>{details.length ? details.join(" · ") : progress.stage === "processing" ? "Almost there…" : "Hang tight…"}</span>
        <button type="button" className="pill" onClick={onCancel}><X size={13} aria-hidden="true" />Cancel</button>
      </div>
    </div>
  );
}

function ErrorBox({ error, onRetry, onDismiss, dismissLabel }) {
  const canRetry = onRetry && !PERMANENT_ERRORS.has(error.code) && error.code !== "not_configured";
  return (
    <div className="note e yd-err" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <b>{ERROR_TITLES[error.code] || "Something went wrong"}</b>
        <p>{error.message}</p>
        {(canRetry || onDismiss) && (
          <div className="pillrow">
            {canRetry && <button type="button" className="pill" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />Try again</button>}
            {onDismiss && <button type="button" className="pill" onClick={onDismiss}>{dismissLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ src, duration }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="yd-thumb">
      {src && !failed
        ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : <ImageOff size={28} aria-hidden="true" />}
      {duration && <span className="yd-dur">{duration}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="yd-card yd-skel" role="status" aria-label="Analyzing video">
      <div className="skel yd-thumb" />
      <div className="yd-info">
        <div className="skel" style={{ height: 20, width: "90%" }} />
        <div className="skel" style={{ height: 20, width: "60%", marginTop: 8 }} />
        <div className="skel" style={{ height: 13, width: "35%", marginTop: 12 }} />
        <div className="skel" style={{ height: 44, marginTop: 24 }} />
        <div className="skel" style={{ height: 44, marginTop: 12 }} />
      </div>
    </div>
  );
}

const POLL_MS = 600;

export default function YtDownloaderTool({ notify }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState(null);
  const sRef = useRef(s);
  const analyzeCtl = useRef(null);
  const downloadCtl = useRef(null);
  const jobId = useRef(null);
  const userCancelled = useRef(false);
  const inputRef = useRef(null);
  const resultRef = useRef(null);
  const prevPhase = useRef(s.phase);
  sRef.current = s;

  useEffect(() => () => {
    analyzeCtl.current?.abort();
    downloadCtl.current?.abort();
    if (jobId.current) cancelJob(jobId.current);
  }, []);

  // Bring the result into view when analysis finishes (it can start below the fold on phones).
  useEffect(() => {
    if (prevPhase.current === "analyzing" && (s.phase === "ready" || s.phase === "error")) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      resultRef.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
    }
    prevPhase.current = s.phase;
  }, [s.phase]);

  const analyze = useCallback(async (raw) => {
    const check = checkYouTubeUrl(raw);
    if (!check.ok) { setInputError(check.reason); inputRef.current?.focus(); return; }
    if (sRef.current.phase === "downloading") return;
    setInputError(null);
    analyzeCtl.current?.abort();
    const c = new AbortController();
    analyzeCtl.current = c;
    dispatch({ type: "analyze", url: check.url });
    try {
      const video = await getVideoInfo(check.url, c.signal);
      if (c.signal.aborted) return;
      const want = sRef.current.mode;
      const mode = formatsOf(video, want).length ? want : want === "video" ? "audio" : "video";
      dispatch({ type: "analyzed", video, mode });
    } catch (e) {
      if (!isAbort(e)) dispatch({ type: "fail", error: toError(e, "analyze") });
    } finally {
      if (analyzeCtl.current === c) analyzeCtl.current = null;
    }
  }, []);

  const download = useCallback(async () => {
    const { url, video, formatId, mode, phase } = sRef.current;
    if (!url || !video || !formatId || phase === "downloading") return;
    const format = video.formats.find((f) => f.format_id === formatId);
    const c = new AbortController();
    downloadCtl.current = c;
    userCancelled.current = false;
    dispatch({ type: "download" });
    try {
      let job = await createJob(url, formatId, mode, c.signal);
      jobId.current = job.id;
      while (job.status !== "ready") {
        if (job.status === "error") throw new DownloaderError(job.error?.detail || "The download failed.", job.error?.code || "download_failed");
        if (job.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
        dispatch({ type: "progress", progress: {
          stage: job.status === "processing" ? "processing" : job.status === "queued" ? "queued" : "downloading",
          value: job.status === "downloading" && job.total_bytes ? job.progress ?? 0 : null,
          message: job.message, loaded: job.downloaded_bytes, total: job.total_bytes, speed: job.speed, eta: job.eta,
        } });
        await sleep(POLL_MS, c.signal);
        job = await getJob(job.id, c.signal);
      }
      let lastPaint = 0;
      const { blob, filename } = await fetchJobFile(job.id, (loaded, total) => {
        const now = performance.now();
        if (now - lastPaint < 100 && loaded !== total) return;
        lastPaint = now;
        dispatch({ type: "progress", progress: { stage: "saving", value: total ? loaded / total : null, loaded, total } });
      }, c.signal);
      jobId.current = null;   // the server deletes the file once it has been sent
      const ext = format?.extension || (mode === "audio" ? "mp3" : "mp4");
      const name = safeDownloadName(filename || `${sanitizeFilename(video.title)}.${ext}`, ext);
      saveBlob(blob, name);
      dispatch({ type: "complete", result: { filename: name, size: blob.size } });
      notify?.(`Downloaded ${name}`);
    } catch (e) {
      if (jobId.current) cancelJob(jobId.current);
      jobId.current = null;
      if (isAbort(e)) {
        if (userCancelled.current) { dispatch({ type: "back" }); notify?.("Download cancelled"); }
        return;
      }
      dispatch({ type: "fail", error: toError(e, "download") });
    } finally {
      if (downloadCtl.current === c) downloadCtl.current = null;
    }
  }, [notify]);

  const cancel = () => { userCancelled.current = true; downloadCtl.current?.abort(); };
  const startOver = () => {
    analyzeCtl.current?.abort();
    if (sRef.current.phase === "downloading") cancel();
    dispatch({ type: "reset" });
    setInput("");
    setInputError(null);
    inputRef.current?.focus();
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return notify?.("Your clipboard is empty.");
      setInput(text);
      const check = checkYouTubeUrl(text);
      setInputError(check.ok ? null : check.reason);
    } catch {
      notify?.("Couldn't read the clipboard. Press Ctrl+V (⌘V on Mac) to paste.");
    }
    inputRef.current?.focus();
  };

  const { phase, video, error } = s;
  const busy = phase === "downloading";
  const analyzeFailed = phase === "error" && error?.during === "analyze";
  const formats = formatsOf(video, s.mode);
  const selected = formats.find((f) => f.format_id === s.formatId);
  const duration = formatDuration(video?.duration);

  return (
    <div className="panel yd">
      {!isConfigured() && (
        <div className="note w">The download service isn't connected on this deployment yet, so analysis won't work here.</div>
      )}
      <form className="yd-form" noValidate onSubmit={(e) => { e.preventDefault(); if (phase !== "analyzing" && !busy) analyze(input); }}>
        <div className="field">
          <label htmlFor="yd-url">YouTube video link</label>
          <div className="yd-inwrap">
            <input
              ref={inputRef}
              id="yd-url"
              type="url"
              inputMode="url"
              enterKeyHint="go"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Paste a YouTube link"
              value={input}
              disabled={busy}
              aria-invalid={!!inputError}
              aria-describedby={inputError ? "yd-err" : "yd-hint"}
              onChange={(e) => { setInput(e.target.value); if (inputError) setInputError(null); }}
              onKeyDown={(e) => { if (e.key === "Escape" && input) { e.preventDefault(); setInput(""); setInputError(null); } }}
            />
            {input
              ? <button type="button" className="yd-inbtn" aria-label="Clear link" disabled={busy} onClick={() => { setInput(""); setInputError(null); inputRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button>
              : <button type="button" className="yd-inbtn" aria-label="Paste link from clipboard" disabled={busy} onClick={paste}><ClipboardPaste size={15} aria-hidden="true" /><span>Paste</span></button>}
          </div>
        </div>
        <button type="submit" className="btn pri" disabled={phase === "analyzing" || busy}>
          {phase === "analyzing" ? <Loader2 size={16} className="sd-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
          {phase === "analyzing" ? "Analyzing…" : "Analyze"}
        </button>
      </form>
      {inputError
        ? <p id="yd-err" role="alert" className="yd-hint bad">{inputError}</p>
        : <p id="yd-hint" className="yd-hint">Works with youtube.com/watch, youtu.be and Shorts links. Only download videos you own or have permission to download.</p>}

      <div ref={resultRef} className="yd-out" aria-live="polite">
        {phase === "analyzing" && <Skeleton />}
        {analyzeFailed && <ErrorBox error={error} onRetry={() => s.url && analyze(s.url)} onDismiss={startOver} dismissLabel="Try another link" />}
        {video && !analyzeFailed && phase !== "analyzing" && (
          <article className="yd-card" aria-labelledby="yd-title">
            <Thumb src={video.thumbnail} duration={duration} />
            <div className="yd-info">
              <h2 id="yd-title" title={video.title}>{video.title}</h2>
              <p className="yd-meta"><span>{video.channel}</span>{duration && <><span aria-hidden="true">•</span><span><span className="sr-only">Duration </span>{duration}</span></>}</p>

              <div className="yd-fmthead">
                <label htmlFor="yd-format">Format</label>
                <div className="modes yd-modes" role="group" aria-label="Download type">
                  <button type="button" aria-pressed={s.mode === "video"} className={s.mode === "video" ? "on" : ""} disabled={busy || !formatsOf(video, "video").length} onClick={() => dispatch({ type: "mode", mode: "video" })}><Film size={14} aria-hidden="true" />Video</button>
                  <button type="button" aria-pressed={s.mode === "audio"} className={s.mode === "audio" ? "on" : ""} disabled={busy || !formatsOf(video, "audio").length} onClick={() => dispatch({ type: "mode", mode: "audio" })}><Music2 size={14} aria-hidden="true" />Audio</button>
                </div>
              </div>
              <div className="field yd-select">
                <select id="yd-format" value={s.formatId ?? ""} disabled={busy || !formats.length} onChange={(e) => dispatch({ type: "format", formatId: e.target.value })} aria-describedby="yd-fmt-hint">
                  {formats.map((f) => {
                    const size = formatBytes(f.filesize);
                    return <option key={f.format_id} value={f.format_id}>{formatLabel(f)}{size ? `  —  ~${size}` : ""}</option>;
                  })}
                </select>
              </div>
              <p id="yd-fmt-hint" className="yd-fmthint">
                {selected && [
                  selected.type === "audio" ? selected.note : selected.note && `${selected.note} video with audio`,
                  selected.type === "audio" && selected.resolution,
                  formatBytes(selected.filesize) ? `about ${formatBytes(selected.filesize)}` : "size unknown",
                ].filter(Boolean).join(" · ")}
              </p>

              {phase === "downloading" && s.progress && <Progress progress={s.progress} onCancel={cancel} />}
              {phase === "complete" && s.result && (
                <div className="note ok yd-done" role="status">
                  <span className="yd-tick"><Check size={16} strokeWidth={2.75} aria-hidden="true" /></span>
                  <div>
                    <b>Download complete</b>
                    <p title={s.result.filename}>{s.result.filename}{formatBytes(s.result.size) ? ` · ${formatBytes(s.result.size)}` : ""}</p>
                    <div className="pillrow">
                      <button type="button" className="pill" onClick={download}><RotateCcw size={13} aria-hidden="true" />Download again</button>
                      <button type="button" className="pill" onClick={startOver}>New video</button>
                    </div>
                  </div>
                </div>
              )}
              {phase === "error" && error?.during === "download" && (
                <ErrorBox error={error} onRetry={download} onDismiss={() => dispatch({ type: "back" })} dismissLabel="Choose another format" />
              )}
              {(phase === "ready") && (
                <button type="button" className="btn pri yd-dl" onClick={download} disabled={!s.formatId}>
                  <Download size={16} aria-hidden="true" />{s.mode === "audio" ? "Download audio" : "Download video"}
                </button>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
