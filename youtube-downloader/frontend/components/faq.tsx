import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const QUESTIONS = [
  {
    q: "What am I allowed to download?",
    a: "Only content you own, have the rights holder's permission to download, or that is licensed for downloading (for example under Creative Commons). Respect copyright and YouTube's Terms of Service. You are responsible for how you use this tool.",
  },
  {
    q: "Why can't I download a private, members-only or age-restricted video?",
    a: "Those videos are protected by sign-in, payment or other access controls. ClipDeck only fetches what is publicly reachable and never bypasses restrictions, so you'll see a clear message instead.",
  },
  {
    q: "Why isn't 4K (or 1080p) listed for my video?",
    a: "We only show qualities YouTube actually reports for that video. If the uploader published in 720p, the highest option will be 720p.",
  },
  {
    q: "Which formats are supported?",
    a: "Video downloads are MP4 with the best matching audio merged in. Audio can be saved as MP3 (192 kbps), M4A (AAC) or the original best-quality stream.",
  },
  {
    q: "Do you keep my files or links?",
    a: "No. Each download is processed in a temporary folder with a random name and deleted as soon as it has been sent to you. Anything left behind is removed automatically within half an hour.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes. ClipDeck works in any modern mobile browser. Very large files may take a while to save on slower devices, so pick a lower quality if you're short on space.",
  },
];

export function FAQ() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <div>
          <h2 id="faq-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Questions, answered
          </h2>
          <p className="mt-3 text-muted-foreground sm:text-lg">The short version of how ClipDeck works.</p>
        </div>
        <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 shadow-[var(--shadow-soft)] sm:px-6">
          {QUESTIONS.map(({ q, a }, index) => (
            <AccordionItem key={q} value={`item-${index}`}>
              <AccordionTrigger>{q}</AccordionTrigger>
              <AccordionContent>{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
