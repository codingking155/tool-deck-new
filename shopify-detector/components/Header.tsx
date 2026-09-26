import Link from "next/link";
import { Gem, Star } from "lucide-react";
import { siteConfig } from "@/site.config";
import { GitHubIcon } from "./icons";
import MobileNav from "./MobileNav";

export const NAV_LINKS = [
  { href: "/the-story", label: "The Story" },
  { href: "/blogs", label: "Blogs" },
  { href: "/api-docs", label: "API Docs" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-lg font-bold tracking-tight text-ink">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-white shadow-sm">
            <Gem className="size-4.5" aria-hidden="true" />
          </span>
          <span className="text-lg">{siteConfig.brand}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/70 hover:text-ink">
              {l.label}
            </Link>
          ))}
          <a
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/80 px-3 py-2 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-white"
          >
            <GitHubIcon />
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            Star
          </a>
        </nav>

        <MobileNav links={NAV_LINKS} githubUrl={siteConfig.githubUrl} />
      </div>
    </header>
  );
}
