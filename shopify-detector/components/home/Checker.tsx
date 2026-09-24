"use client";

import { AnimatePresence } from "framer-motion";
import { ArrowUpRight, Globe, LoaderCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizeInput } from "@/lib/detect/normalize";
import { parsePrefixPath } from "@/lib/prefix";
import { trackCheck } from "@/lib/analytics";
import type { ApiError, CheckResult } from "@/lib/types";
import ResultCard from "./ResultCard";
import { ErrorCard, ResultSkeleton } from "./StatusCards";
import { useToast } from "./Toast";

type State =
  | { status: "idle" }
  | { status: "loading"; host: string }
  | { status: "result"; data: CheckResult; query: string }
  | { status: "error"; error: ApiError; query: string };

const NETWORK_ERROR: ApiError = {
  error: "network",
  message: "We couldn't reach our servers. Check your connection and try again.",
};

/** The query encoded in the current address bar: /?url=x or the /x prefix route. */
function queryFromLocation(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get("url");
  if (fromSearch) return fromSearch;
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length ? parsePrefixPath(segments) : null;
}

export default function Checker({ initialQuery, between }: { initialQuery?: string; between?: ReactNode }) {
  const [value, setValue] = useState(initialQuery ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>(initialQuery ? { status: "loading", host: initialQuery } : { status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const inflight = useRef<AbortController | null>(null);
  const toast = useToast();

  const run = useCallback(async (raw: string, { push, fillInput = false }: { push: boolean; fillInput?: boolean }) => {
    if (fillInput) setValue(raw);
    let host: string;
    try {
      host = normalizeInput(raw).host;
    } catch (e) {
      setInputError((e as Error).message);
      inputRef.current?.focus();
      return;
    }
    setInputError(null);
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setState({ status: "loading", host });

    if (push) {
      // A prefix page re-checking its own domain keeps its /example.com address.
      const onOwnPrefix = parsePrefixPath(window.location.pathname.split("/").filter(Boolean)) === host;
      if (!onOwnPrefix) window.history.pushState(null, "", `/?url=${encodeURIComponent(host)}`);
    }

    try {
      const res = await fetch(`/api/check?url=${encodeURIComponent(raw.trim())}`, { signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (res.ok && body) {
        setState({ status: "result", data: body as CheckResult, query: raw.trim() });
        trackCheck((body as CheckResult).is_shopify ? "shopify" : "not_shopify");
      } else {
        const error = (body as ApiError | null) ?? { error: "internal", message: "Something went wrong. Please try again." };
        setState({ status: "error", error, query: raw.trim() });
        trackCheck("error", error.error);
      }
    } catch {
      if (controller.signal.aborted) return;
      setState({ status: "error", error: NETWORK_ERROR, query: raw.trim() });
      trackCheck("error", NETWORK_ERROR.error);
    }
  }, []);

  const reset = useCallback(() => {
    inflight.current?.abort();
    setState({ status: "idle" });
    setValue("");
    setInputError(null);
  }, []);

  useEffect(() => {
    const syncFromLocation = (q: string | null) => (q ? run(q, { push: false, fillInput: true }) : reset());
    const initial = initialQuery ?? queryFromLocation();
    if (initial) syncFromLocation(initial);
    const onPop = () => syncFromLocation(queryFromLocation());
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      inflight.current?.abort();
    };
  }, [initialQuery, run, reset]);

  const loading = state.status === "loading";
  const showGoBack = state.status === "result" && value.trim() === state.query;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (showGoBack) {
      reset();
      window.history.pushState(null, "", "/");
      inputRef.current?.focus();
      return;
    }
    run(value, { push: true });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show("Copied!");
    } catch {
      toast.show("Couldn't copy — select the URL and copy it manually.");
    }
  };

  const announcement =
    state.status === "loading"
      ? `Checking ${state.host}…`
      : state.status === "result"
        ? `${state.data.final_url} is ${state.data.is_shopify ? `a Shopify store, ${Math.round(state.data.confidence * 100)}% confidence` : "not a Shopify store"}.`
        : state.status === "error"
          ? `Check failed: ${state.error.message}`
          : "";

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-2xl" role="search" aria-label="Check a website">
        <div className="card flex flex-col gap-2 p-2 sm:flex-row">
          <label htmlFor="site-url" className="sr-only">
            Website URL
          </label>
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              id="site-url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Enter website URL (e.g., example.com)"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (inputError) setInputError(null);
              }}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? "site-url-error" : undefined}
              className="h-14 w-full rounded-xl bg-white pl-12 pr-4 text-base text-ink outline-none ring-brand/30 placeholder:text-muted/80 focus-visible:ring-4"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-brand px-7 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-80"
          >
            {loading ? (
              <>
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> Checking…
              </>
            ) : showGoBack ? (
              <>
                <ArrowUpRight className="size-5" aria-hidden="true" /> Go Back
              </>
            ) : (
              <>
                <Zap className="size-5" aria-hidden="true" /> Check Now
              </>
            )}
          </button>
        </div>
        {inputError && (
          <p id="site-url-error" role="alert" className="mt-2 text-left text-sm font-medium text-danger">
            {inputError}
          </p>
        )}
      </form>

      {between}

      <section aria-label="Check result" className="mx-auto mt-8 w-full max-w-3xl">
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <AnimatePresence mode="wait">
          {state.status === "loading" && <ResultSkeleton key="loading" />}
          {state.status === "result" && (
            <ResultCard key={`r-${state.data.final_url}`} data={state.data} onCopy={() => copy(state.data.final_url)} />
          )}
          {state.status === "error" && (
            <ErrorCard
              key="error"
              error={state.error}
              onRetry={() => (state.error.error === "invalid_url" ? inputRef.current?.focus() : run(state.query, { push: false }))}
            />
          )}
        </AnimatePresence>
      </section>
      {toast.node}
    </>
  );
}
