import { Check, ShieldCheck, Sparkles, Star, Zap } from "lucide-react";
import { siteConfig } from "@/site.config";
import { getStarCount } from "@/lib/github";
import Checker from "./Checker";
import FeatureCards from "./FeatureCards";

export default async function HomeView({ initialQuery }: { initialQuery?: string }) {
  const stars = await getStarCount();

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-10 text-center sm:px-6 sm:pt-16">
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        <a
          href={siteConfig.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1 text-sm font-medium text-ink shadow-sm hover:bg-white"
        >
          <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
          {stars.toLocaleString("en-US")} GitHub star{stars === 1 ? "" : "s"}
        </a>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-success-bg px-3 py-1 text-xs font-medium text-brand sm:text-sm">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Going To Be Trusted by 10,000+ Sales Teams
        </span>
      </div>

      <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-[56px] sm:leading-[1.1]">
        Is It a <span className="text-accent">Shopify</span> Store?
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Qualify leads faster — for Shopify app sales teams working at scale.</p>

      <ul className="mb-8 mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-medium text-ink">
        <li className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-brand" aria-hidden="true" /> Secure
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Zap className="size-4 text-brand" aria-hidden="true" /> Fast
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Check className="size-4 text-brand" aria-hidden="true" /> Accurate
        </li>
      </ul>

      <Checker
        initialQuery={initialQuery}
        between={
          <p className="mx-auto mt-6 max-w-xl text-sm text-muted">
            If you sell to Shopify merchants, <strong className="font-semibold text-danger">not every website</strong> in your lead list is
            actually a Shopify store. Your sales team wastes at least <strong className="font-semibold text-brand">21hrs/week</strong>{" "}
            qualifying leads manually — let&apos;s eliminate that.
          </p>
        }
      />

      <div className="mt-12">
        <FeatureCards />
      </div>

      <aside className="mx-auto mt-14 max-w-lg">
        <h2 className="font-semibold text-ink">Caught us calling a store by the wrong name?</h2>
        <p className="mt-1 text-sm text-muted">
          We read a lot of HTML so your team doesn&apos;t have to, but even the best detectives misread a clue now and then. Send the URL to{" "}
          <a href={`mailto:${siteConfig.email}`} className="font-medium text-brand underline underline-offset-4">
            {siteConfig.email}
          </a>{" "}
          and we&apos;ll fix it — then quietly pretend it never happened.
        </p>
      </aside>
    </div>
  );
}
