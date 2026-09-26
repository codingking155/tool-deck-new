"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { highlightJson } from "./JsonView";

export default function TryItLive() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<{ status: number; body: string } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/check?url=${encodeURIComponent(url.trim())}`);
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON — show it raw.
      }
      setOutput({ status: res.status, body });
    } catch {
      setOutput({ status: 0, body: '{ "error": "network", "message": "Request failed — check your connection." }' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="try-url" className="sr-only">
          Website to check
        </label>
        <input
          id="try-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="example.com"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 flex-1 rounded-lg border border-line bg-white px-3 font-mono text-sm outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-api px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-80"
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          Send request
        </button>
      </form>
      <div aria-live="polite">
        {output && (
          <div className="mt-4 overflow-hidden rounded-xl bg-[#0d1714]">
            <div className="border-b border-white/10 px-4 py-2 font-mono text-xs text-white/70">
              HTTP {output.status || "—"}
            </div>
            <pre className="max-h-96 overflow-auto p-4 font-mono text-sm leading-relaxed text-emerald-50">
              <code>{highlightJson(output.body)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
