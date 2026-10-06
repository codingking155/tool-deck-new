"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ClipboardPaste, Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checkYouTubeUrl } from "@/lib/youtube";

export interface URLInputHandle {
  focus: () => void;
  clear: () => void;
}

interface URLInputProps {
  onSubmit: (url: string) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Canonical URL of the video currently shown, so the clipboard hint doesn't repeat it. */
  currentUrl?: string | null;
}

async function clipboardReadGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false; // Firefox/Safari don't expose this permission
  }
}

export const URLInput = forwardRef<URLInputHandle, URLInputProps>(function URLInput(
  { onSubmit, loading = false, disabled = false, currentUrl },
  ref,
) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const errorId = useId();
  const hintId = useId();

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      setValue("");
      setError(null);
      inputRef.current?.focus();
    },
  }));

  const submit = useCallback(
    (raw: string) => {
      const check = checkYouTubeUrl(raw);
      if (!check.ok) {
        setError(check.reason);
        inputRef.current?.focus();
        return;
      }
      setError(null);
      setSuggestion(null);
      onSubmit(raw.trim());
    },
    [onSubmit],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Clipboard detection: only when the browser already granted read access (never prompts),
  // and only as a suggestion. Nothing is analysed or downloaded until the user acts.
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (!(await clipboardReadGranted())) return;
      try {
        const text = (await navigator.clipboard.readText()).trim();
        const check = checkYouTubeUrl(text);
        if (!cancelled && check.ok && check.url !== currentUrl && text !== valueRef.current.trim()) setSuggestion(text);
      } catch {
        /* clipboard unavailable or document not focused */
      }
    };
    void detect();
    window.addEventListener("focus", detect);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", detect);
    };
  }, [currentUrl]);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast("Your clipboard is empty");
        return;
      }
      setValue(text);
      setSuggestion(null);
      const check = checkYouTubeUrl(text);
      setError(check.ok ? null : check.reason);
      inputRef.current?.focus();
    } catch {
      toast("Couldn't read the clipboard", {
        description: "Your browser blocked clipboard access. Press Ctrl+V (⌘V on Mac) to paste instead.",
      });
      inputRef.current?.focus();
    }
  };

  const busy = loading || disabled;
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(" ");

  return (
    <div className="w-full">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) submit(value);
        }}
        className={cn(
          "group relative flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-[var(--shadow-lift)] transition-[border-color,box-shadow] duration-200 sm:flex-row sm:items-center",
          "focus-within:border-ring/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--ring)_18%,transparent),var(--shadow-lift)]",
          error && "border-destructive/60 focus-within:border-destructive/70",
        )}
      >
        <label htmlFor="video-url" className="sr-only">
          YouTube video URL
        </label>
        <div className="relative flex min-w-0 flex-1 items-center">
          <Link2 className="pointer-events-none absolute left-3.5 size-5 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            id="video-url"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Paste a YouTube link"
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && value) {
                event.preventDefault();
                setValue("");
                setError(null);
              }
            }}
            className="h-12 w-full min-w-0 rounded-xl bg-transparent pr-24 pl-11 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed sm:h-14 sm:text-[17px]"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Clear link"
                disabled={disabled}
                onClick={() => {
                  setValue("");
                  setError(null);
                  inputRef.current?.focus();
                }}
              >
                <X aria-hidden />
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={paste} disabled={disabled} aria-label="Paste link from clipboard">
                <ClipboardPaste aria-hidden />
                <span>Paste</span>
              </Button>
            )}
          </div>
        </div>
        <Button type="submit" size="lg" disabled={busy} className="h-12 w-full rounded-xl sm:h-14 sm:w-auto sm:min-w-36">
          {loading ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Analyzing
            </>
          ) : (
            <>
              Analyze
              <ArrowRight className="transition-transform duration-200 group-focus-within:translate-x-0.5" aria-hidden />
            </>
          )}
        </Button>
      </form>

      <div className="mt-3 min-h-6 px-1 text-sm">
        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <motion.p
              key="error"
              id={errorId}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-destructive"
            >
              {error}
            </motion.p>
          ) : suggestion ? (
            <motion.div
              key="suggestion"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted-foreground"
            >
              <span>Link found in your clipboard:</span>
              <button
                type="button"
                onClick={() => {
                  setValue(suggestion);
                  setSuggestion(null);
                  inputRef.current?.focus();
                }}
                className="max-w-full truncate rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Use {suggestion.replace(/^https?:\/\/(www\.)?/, "")}
              </button>
            </motion.div>
          ) : (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-muted-foreground"
            >
              Works with youtube.com/watch, youtu.be and Shorts links.
            </motion.p>
          )}
        </AnimatePresence>
        <span id={hintId} className="sr-only">
          Press Enter to analyze. Press Escape to clear.
        </span>
      </div>
    </div>
  );
});
