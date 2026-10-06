import { ShieldCheck } from "lucide-react";

import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Logo className="text-foreground" />
          <p className="text-sm text-muted-foreground">Download videos. Simple, fast, clean.</p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground md:text-right">
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4" aria-hidden />
            Only download content you own or have permission to download.
          </p>
          <p className="text-xs">
            Not affiliated with or endorsed by YouTube or Google. © {new Date().getFullYear()} ClipDeck.
          </p>
        </div>
      </div>
    </footer>
  );
}
