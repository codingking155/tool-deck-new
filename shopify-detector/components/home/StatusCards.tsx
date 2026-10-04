"use client";

import { motion } from "framer-motion";
import { RotateCcw, TriangleAlert } from "lucide-react";
import type { ApiError } from "@/lib/types";

export function ResultSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="card stripes space-y-5 p-5 sm:p-6"
      aria-hidden="true"
    >
      <div className="flex items-center gap-3">
        <div className="skeleton size-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-5 w-48 max-w-full" />
          <div className="skeleton h-4 w-28" />
        </div>
      </div>
      <div className="skeleton h-11 w-full rounded-xl" />
      <div className="skeleton h-16 w-full rounded-xl" />
      <div className="skeleton h-3 w-full rounded-full" />
      <div className="grid grid-cols-3 gap-3">
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
      </div>
    </motion.div>
  );
}

function errorTitle(e: ApiError): string {
  if (e.error === "invalid_url") return "That URL can't be checked";
  if (e.error === "timeout") return "The site took too long to respond";
  if (e.error === "rate_limited") return "Slow down a little";
  if (e.error === "unreachable") {
    if (e.reason === "dns") return "We couldn't find that site";
    if (e.reason === "blocked") return "The site blocked our check";
    return "We couldn't reach that site";
  }
  return "Something went wrong";
}

export function ErrorCard({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex flex-col items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-5 text-left shadow-sm sm:flex-row sm:items-center sm:p-6"
    >
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
        <TriangleAlert className="size-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-amber-900">{errorTitle(error)}</h2>
        <p className="text-sm text-amber-900/90">{error.message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Try again
      </button>
    </motion.div>
  );
}
