"use client";

import { motion } from "framer-motion";
import { ChevronDown, CircleCheck, CircleX, Copy, ExternalLink, Globe, Shield, ShieldCheck, ShoppingBag, Zap } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { speedLabel, type CheckResult } from "@/lib/types";

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

function ActionButtons({ url, onCopy }: { url: string; onCopy: () => void }) {
  const btn =
    "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-mint";
  return (
    <div className="flex shrink-0 gap-2">
      <button type="button" onClick={onCopy} className={btn}>
        <Copy className="size-4" aria-hidden="true" /> Copy
      </button>
      <a href={safeHref(url)} target="_blank" rel="noopener noreferrer" className={btn}>
        <ExternalLink className="size-4" aria-hidden="true" /> Visit
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/80 p-3 text-center">
      <div className="mx-auto mb-1.5 grid size-8 place-items-center rounded-lg bg-success-bg text-brand">{icon}</div>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function TechnicalDetails({ data }: { data: CheckResult }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const headers = Object.entries(data.headers_sample);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white/80 px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-mint"
      >
        {open ? "Hide Technical Details" : "Show Technical Details"}
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="mt-3 space-y-4 rounded-xl border border-line bg-white/80 p-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted">DETECTED SIGNALS</h3>
            {data.detected_signals.length ? (
              <ul className="flex flex-wrap gap-2">
                {data.detected_signals.map((s) => (
                  <li key={s} className="rounded-md border border-line bg-mint px-2 py-1 font-mono text-xs text-ink">
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No Shopify signals were found.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted">HEADERS SAMPLE</h3>
            {headers.length ? (
              <dl className="space-y-1 font-mono text-xs">
                {headers.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-2 break-all">
                    <dt className="font-semibold text-ink">{k}:</dt>
                    <dd className="text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted">No notable headers were returned.</p>
            )}
          </div>
          <p className="text-xs text-muted">
            Checked in {data.elapsed_ms} ms{data.cached ? " · served from cache" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ResultCard({ data, onCopy }: { data: CheckResult; onCopy: () => void }) {
  const shopify = data.is_shopify;
  const pct = Math.round(data.confidence * 100);
  const secure = data.final_url.startsWith("https://");
  const signalCount = data.detected_signals.length;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="card stripes space-y-5 p-5 text-left sm:p-6"
      aria-labelledby="result-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid size-12 shrink-0 place-items-center rounded-xl ${shopify ? "bg-success-bg text-brand" : "bg-error-bg text-danger"}`}>
            {shopify ? <CircleCheck className="size-6" aria-hidden="true" /> : <CircleX className="size-6" aria-hidden="true" />}
          </div>
          <div>
            <h2 id="result-title" className={`text-xl font-bold tracking-tight ${shopify ? "text-brand" : "text-danger"}`}>
              {shopify ? "Shopify Store Detected!" : "Not a Shopify Store"}
            </h2>
            {shopify && <p className="text-sm text-muted">Confidence: {pct}%</p>}
          </div>
        </div>
        <ActionButtons url={data.final_url} onCopy={onCopy} />
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-gray-100/80 px-4 py-3">
        <Globe className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-[12rem] flex-1 break-all font-mono text-sm text-ink">{data.final_url}</span>
        {data.shop_domain && <span className="text-xs font-semibold text-brand">{data.shop_domain}</span>}
      </div>

      {shopify ? (
        <div className="rounded-xl bg-success-bg px-4 py-3">
          <p className="font-semibold text-brand">
            <span aria-hidden="true">✅ </span>This is a Shopify store!
          </p>
          <p className="text-sm text-ink">
            {data.shop_domain && <>Shop domain: {data.shop_domain} • </>}
            {signalCount} Shopify signal{signalCount === 1 ? "" : "s"} detected
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-error-bg px-4 py-3">
          <p className="font-semibold text-danger">
            <span aria-hidden="true">❌ </span>Not a Shopify store
          </p>
          <p className="text-sm text-ink">This website does not appear to be powered by Shopify.</p>
        </div>
      )}

      {shopify && (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span className="text-ink">Detection Confidence</span>
              <span className="text-brand">{pct}%</span>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Detection confidence"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile icon={<ShoppingBag className="size-4" aria-hidden="true" />} label="Platform" value="Shopify" />
            <StatTile
              icon={secure ? <ShieldCheck className="size-4" aria-hidden="true" /> : <Shield className="size-4" aria-hidden="true" />}
              label="SSL"
              value={secure ? "Secure" : "Not secure"}
            />
            <StatTile icon={<Zap className="size-4" aria-hidden="true" />} label="Speed" value={speedLabel(data.elapsed_ms)} />
          </div>
        </>
      )}

      <TechnicalDetails key={data.final_url} data={data} />
    </motion.article>
  );
}
