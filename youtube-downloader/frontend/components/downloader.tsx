"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { DownloadButton } from "@/components/download-button";
import { DownloadComplete } from "@/components/download-complete";
import { DownloadProgress } from "@/components/download-progress";
import { ErrorState } from "@/components/error-state";
import { FormatSelector } from "@/components/format-selector";
import { URLInput, type URLInputHandle } from "@/components/url-input";
import { VideoPreview } from "@/components/video-preview";
import { VideoPreviewSkeleton } from "@/components/video-preview-skeleton";
import { formatsFor, useDownloader } from "@/hooks/use-downloader";

const panel = {
  initial: { opacity: 0, y: 12, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.99 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

const swap = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

export function Downloader() {
  const { state, analyze, setMode, setFormat, download, cancel, dismissError, reset } = useDownloader();
  const inputRef = useRef<URLInputHandle>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { phase, video, error } = state;
  const previousPhase = useRef(phase);

  // Bring the result into view once analysis finishes (the card may start below the fold).
  useEffect(() => {
    if (previousPhase.current === "analyzing" && (phase === "ready" || phase === "error")) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" }),
        320,
      );
    }
    previousPhase.current = phase;
  }, [phase]);

  const analyzeFailed = phase === "error" && error?.during === "analyze";
  const showVideo = video && !analyzeFailed && phase !== "analyzing";
  const formats = formatsFor(video, state.mode);

  const startOver = () => {
    reset();
    inputRef.current?.clear();
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <URLInput
        ref={inputRef}
        onSubmit={(url) => void analyze(url)}
        loading={phase === "analyzing"}
        disabled={phase === "downloading"}
        currentUrl={state.url}
      />

      <div ref={resultRef} className="mt-6 scroll-mb-6" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "analyzing" ? (
            <motion.div key="skeleton" {...panel}>
              <VideoPreviewSkeleton />
            </motion.div>
          ) : analyzeFailed && error ? (
            <motion.div key="analyze-error" {...panel}>
              <ErrorState
                code={error.code}
                message={error.message}
                onRetry={() => state.url && void analyze(state.url)}
                onDismiss={startOver}
                dismissLabel="Try another link"
              />
            </motion.div>
          ) : showVideo ? (
            <motion.div key={`video-${video.id}`} {...panel}>
              <VideoPreview video={video}>
                <FormatSelector
                  mode={state.mode}
                  onModeChange={setMode}
                  formats={formats}
                  hasVideo={formatsFor(video, "video").length > 0}
                  hasAudio={formatsFor(video, "audio").length > 0}
                  value={state.formatId}
                  onChange={setFormat}
                  disabled={phase === "downloading"}
                />
                <AnimatePresence mode="wait" initial={false}>
                  {phase === "downloading" && state.progress ? (
                    <motion.div key="progress" {...swap}>
                      <DownloadProgress progress={state.progress} onCancel={cancel} />
                    </motion.div>
                  ) : phase === "complete" && state.result ? (
                    <motion.div key="complete" {...swap}>
                      <DownloadComplete
                        filename={state.result.filename}
                        size={state.result.size}
                        onDownloadAgain={() => void download()}
                        onNewVideo={startOver}
                      />
                    </motion.div>
                  ) : phase === "error" && error ? (
                    <motion.div key="download-error" {...swap}>
                      <ErrorState
                        compact
                        code={error.code}
                        message={error.message}
                        onRetry={() => void download()}
                        onDismiss={dismissError}
                      />
                    </motion.div>
                  ) : (
                    <motion.div key="button" {...swap}>
                      <DownloadButton mode={state.mode} onClick={() => void download()} disabled={!state.formatId} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </VideoPreview>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
