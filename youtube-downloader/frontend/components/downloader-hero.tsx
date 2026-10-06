"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { Downloader } from "@/components/downloader";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export function DownloaderHero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="bg-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]" aria-hidden />
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <motion.p
            {...rise(0)}
            className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-[13px] text-muted-foreground shadow-[var(--shadow-soft)] backdrop-blur"
          >
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            Video up to 4K · MP3 &amp; M4A audio
          </motion.p>
          <motion.h1
            {...rise(0.06)}
            id="hero-title"
            className="mt-6 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl"
          >
            Download videos.
            <span className="block bg-gradient-to-b from-foreground to-foreground/55 bg-clip-text text-transparent">
              Simple, fast, clean.
            </span>
          </motion.h1>
          <motion.p
            {...rise(0.12)}
            className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg"
          >
            Paste a YouTube link, pick a quality, and save video or audio you own or have permission to use. No
            sign-up, no clutter.
          </motion.p>
        </div>
        <motion.div {...rise(0.18)} className="mt-10 sm:mt-12">
          <Downloader />
        </motion.div>
      </div>
    </section>
  );
}
