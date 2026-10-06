import { Gauge, Layers, ListChecks, Music2, ShieldCheck, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Layers,
    title: "Every available quality",
    body: "From 360p up to 4K. We only list the resolutions the video actually offers, so what you pick is what you get.",
  },
  {
    icon: Music2,
    title: "Audio, extracted cleanly",
    body: "Switch to Audio for an MP3 that plays anywhere, an M4A without re-encoding, or the original stream untouched.",
  },
  {
    icon: Gauge,
    title: "Real progress, not a spinner",
    body: "Watch each step as it happens: fetching from YouTube, merging with FFmpeg, then saving to your device.",
  },
  {
    icon: Trash2,
    title: "Nothing is kept",
    body: "Files live in a temporary folder only until they reach you, then they're deleted. Leftovers are swept automatically.",
  },
  {
    icon: ShieldCheck,
    title: "Safe by design",
    body: "Only genuine YouTube links are accepted, rebuilt server-side before anything is fetched. No scripts, no shell tricks.",
  },
  {
    icon: ListChecks,
    title: "Plays by the rules",
    body: "Private, members-only, paid and region-locked videos stay that way. We tell you why instead of working around it.",
  },
];

export function FeatureCards() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <h2 id="features-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p className="mt-3 text-muted-foreground sm:text-lg">
            A focused tool that does one thing well, with the details taken care of.
          </p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="group rounded-2xl border bg-card p-6 shadow-[var(--shadow-soft)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-input/50 hover:shadow-[var(--shadow-lift)] motion-reduce:hover:translate-y-0"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary ring-1 ring-border">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
