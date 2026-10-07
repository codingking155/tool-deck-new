import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Check, ClipboardPaste, Clock, Download, Film, ImageOff, Loader2, Music2, RotateCcw, Search, X } from "lucide-react";
import { Notice } from "../components/ui.jsx";
import {
  checkYouTubeUrl, defaultFormat, formatBytes, formatDuration, formatEta, formatLabel, formatsOf, safeDownloadName,
  sanitizeFilename, ERROR_TITLES, PERMANENT_ERRORS,
} from "./ytdl/core.js";
import { cancelJob, createJob, DownloaderError, getJob, getVideoInfo, isConfigured, jobFileUrl } from "./ytdl/api.js";
import "./css/yt.css";

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

/* The anchor has no download attribute (ignored cross-origin anyway): the server
   answers with Content-Disposition: attachment, so the browser downloads in place. */
function startFileDownload(href) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
            <span>{i < step ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>{label}
            {i < step && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>
      {/* only the stage is announced; the percentage lives on the progressbar so it isn't read out every tick */}
      <div className="yd-ptitle"><b aria-live="polite">{title}</b><span aria-hidden="true">{pct == null ? "" : `${pct}%`}</span></div>
      <div className={`yd-bar${pct == null ? " ind" : ""}`} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
        style={pct == null ? undefined : { "--p": pct / 100 }}>
        <i />
      </div>
      <div className="yd-pfoot">
        <span>{details.length ? details.join(" · ") : progress.stage === "processing" ? "Almost there…" : "Hang tight…"}</span>
        <button type="button" className="btn gh sm" onClick={onCancel}><X size={14} aria-hidden="true" />Cancel</button>
      </div>
    </div>
  );
}

/* What the person can do about each failure — the URL always stays in the field. */
const RECOVERY = {
  not_configured: "This deployment has no download service connected.",
  backend_unavailable: "The service may be starting up or briefly down. Try again in a minute.",
  network: "Check your connection, then try again.",
  private: "Only the owner can see it. Ask them to make it public or unlisted, then try again.",
  members_only: "It's limited to channel members, so it can't be downloaded here.",
  age_restricted: "Age-restricted videos need a signed-in YouTube account, which this tool never uses.",
  paid: "Paid videos can't be downloaded here.",
  restricted: "YouTube doesn't make this video publicly available.",
  region_restricted: "It's blocked in the region our download server runs in. Try a different video.",
  unavailable: "Check the link is right, or try another video.",
  removed: "The video was taken down. Try another link.",
  live: "Try again once the stream has ended and YouTube has processed the recording.",
  rate_limited: "Wait a minute, then try again.",
  too_many_jobs: "Wait for your other downloads to finish, then try again.",
  busy: "Lots of people are downloading right now — try again shortly.",
  format_unavailable: "Pick another quality from the list.",
  too_large: "Pick a lower quality, or audio only.",
  too_long: "Videos over the length limit can't be processed.",
  processing_failed: "Try again, or pick another quality.",
  ffmpeg_missing: "Try a different format — conversion isn't available right now.",
};

function ErrorBox({ error, onRetry, onDismiss, dismissLabel }) {
  const canRetry = onRetry && !PERMANENT_ERRORS.has(error.code) && error.code !== "not_configured";
  const tone = error.code === "network" || error.code === "backend_unavailable" ? "off" : PERMANENT_ERRORS.has(error.code) ? "w" : "e";
  return (
    <Notice tone={tone} role="alert" className="yd-err" title={ERROR_TITLES[error.code] || "Something went wrong"}
      actions={(canRetry || onDismiss) && (
        <>
          {canRetry && <button type="button" className="btn gh sm" onClick={onRetry}><RotateCcw size={14} aria-hidden="true" />Try again</button>}
          {onDismiss && <button type="button" className="btn qt sm" onClick={onDismiss}>{dismissLabel}</button>}
        </>
      )}>
      {error.message && error.message !== ERROR_TITLES[error.code] && <p>{error.message}</p>}
      {RECOVERY[error.code] && <p className="yd-recover">{RECOVERY[error.code]}</p>}
    </Notice>
  );
}

function Thumb({ src, duration }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="yd-thumb">
      {src && !failed
        ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : <ImageOff size={28} aria-hidden="true" />}
      {duration && <span className="yd-dur" aria-hidden="true">{duration}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="panel yd-card yd-skel" role="status" aria-label="Fetching video info">
      <div className="skel yd-thumb" />
      <div className="yd-info">
        <div className="skel yd-sk yd-sk-t1" />
        <div className="skel yd-sk yd-sk-t2" />
        <div className="skel yd-sk yd-sk-meta" />
        <div className="skel yd-sk yd-sk-row" />
        <div className="skel yd-sk yd-sk-row" />
      </div>
    </div>
  );
}

/* "Download 1080p · MP4" — names exactly the option the backend offered and the person picked. */
const downloadLabel = (f, mode) => (f ? `Download ${formatLabel(f)}` : mode === "audio" ? "Download audio" : "Download video");

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
      startFileDownload(jobFileUrl(job.id));
      jobId.current = null;   // the server deletes the file once it has been sent
      const ext = format?.extension || (mode === "audio" ? "mp3" : "mp4");
      const name = safeDownloadName(job.filename || `${sanitizeFilename(video.title)}.${ext}`, ext);
      dispatch({ type: "complete", result: { filename: name, size: job.filesize } });
      notify?.(`Saving ${name} — check your browser's downloads`);
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

  /* after a failed lookup, go back to the field with the link still in it, selected for editing */
  const editLink = () => {
    dispatch({ type: "reset" });
    setInputError(null);
    inputRef.current?.focus();
    inputRef.current?.select();
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

  const announce = phase === "ready" && video ? `Video found: ${video.title}. Choose a format to download.`
    : phase === "complete" && s.result ? `Download started: ${s.result.filename}. Check your browser's downloads.` : "";

  return (
    <div className="yd">
      {!isConfigured() && (
        <Notice tone="w">The download service isn't connected on this deployment yet, so fetching video info won't work here.</Notice>
      )}
      <div className="panel">
        <div className="pb">
          <form className="yd-form" noValidate onSubmit={(e) => { e.preventDefault(); if (phase !== "analyzing" && !busy) analyze(input); }}>
            <div className="field">
              <label htmlFor="yd-url">YouTube video link</label>
              <div className="yd-inwrap">
                <input
                  ref={inputRef}
                  id="yd-url"
                  className="mono"
                  type="url"
                  inputMode="url"
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="https://www.youtube.com/watch?v=…"
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
              {phase === "analyzing" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {phase === "analyzing" ? "Fetching…" : "Fetch info"}
            </button>
          </form>
          {inputError
            ? <p id="yd-err" role="alert" className="err-tx yd-hint">{inputError}</p>
            : <p id="yd-hint" className="hint yd-hint">Works with youtube.com/watch, youtu.be and Shorts links. Only download videos you own or have permission to use.</p>}
        </div>
      </div>

      <p className="sr-only" role="status">{announce}</p>

      <div ref={resultRef} className="yd-out">
        {phase === "analyzing" && <Skeleton />}
        {analyzeFailed && <ErrorBox error={error} onRetry={() => s.url && analyze(s.url)} onDismiss={editLink} dismissLabel="Edit the link" />}
        {video && !analyzeFailed && phase !== "analyzing" && (
          <article className="panel yd-card" aria-labelledby="yd-title">
            <div className="yd-media">
              <Thumb src={video.thumbnail} duration={duration} />
              <h2 id="yd-title" title={video.title}>{video.title}</h2>
              <p className="yd-meta">
                <span className="yd-chan">{video.channel}</span>
                {duration && <span className="yd-len"><Clock size={13} aria-hidden="true" /><span className="sr-only">Duration </span>{duration}</span>}
              </p>
            </div>

            <div className="yd-info">
              <div className="yd-fmthead">
                <span className="yd-lbl" id="yd-type-lbl">Download as</span>
                <div className="seg yd-modes" role="group" aria-labelledby="yd-type-lbl">
                  <button type="button" aria-pressed={s.mode === "video"} disabled={busy || !formatsOf(video, "video").length} onClick={() => dispatch({ type: "mode", mode: "video" })}><Film size={14} aria-hidden="true" />Video</button>
                  <button type="button" aria-pressed={s.mode === "audio"} disabled={busy || !formatsOf(video, "audio").length} onClick={() => dispatch({ type: "mode", mode: "audio" })}><Music2 size={14} aria-hidden="true" />Audio</button>
                </div>
              </div>

              <fieldset className="yd-quality" disabled={busy || !formats.length}>
                <legend className="yd-lbl">Quality <span>· {formats.length} offered for this video</span></legend>
                <div className="yd-opts">
                  {formats.map((f) => {
                    const size = formatBytes(f.filesize);
                    const note = f.type === "audio" ? [f.note, f.resolution].filter(Boolean).join(" · ") : f.note && `${f.note} video with audio`;
                    return (
                      <label key={f.format_id} className={`yd-opt${f.format_id === s.formatId ? " on" : ""}`}>
                        <input type="radio" name="yd-format" value={f.format_id} checked={f.format_id === s.formatId}
                          onChange={() => dispatch({ type: "format", formatId: f.format_id })} />
                        <span className="yd-opt-main">
                          <b>{formatLabel(f)}</b>
                          {note && <small>{note}</small>}
                        </span>
                        <span className={`yd-size${size ? "" : " unk"}`}>{size ? `~${size}` : "size unknown"}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {phase === "downloading" && s.progress && <Progress progress={s.progress} onCancel={cancel} />}
              {phase === "complete" && s.result && (
                <Notice tone="ok" className="yd-done" title="Download started" actions={
                  <>
                    <button type="button" className="btn gh sm" onClick={download}><RotateCcw size={14} aria-hidden="true" />Download again</button>
                    <button type="button" className="btn qt sm" onClick={startOver}>New video</button>
                  </>
                }>
                  <p className="yd-file" title={s.result.filename}>{s.result.filename}{formatBytes(s.result.size) ? ` · ${formatBytes(s.result.size)}` : ""}</p>
                  <p className="yd-hint">Your browser is saving it — see its downloads bar or list.</p>
                </Notice>
              )}
              {phase === "error" && error?.during === "download" && (
                <ErrorBox error={error} onRetry={download} onDismiss={() => dispatch({ type: "back" })} dismissLabel="Choose another format" />
              )}
              {(phase === "ready") && (
                <button type="button" className="btn pri yd-dl" onClick={download} disabled={!s.formatId}>
                  <Download size={16} aria-hidden="true" />{downloadLabel(selected, s.mode)}
                </button>
              )}
              <p className="yd-legal">Downloads run through ToolDeck's server and the file is deleted once it's sent to you. Respect the creator's rights.</p>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
