import Link from "next/link";
import { ClipboardPaste, CodeXml, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { siteConfig } from "@/site.config";

function Card({ icon, tile, title, children }: { icon: ReactNode; tile: string; title: string; children: ReactNode }) {
  return (
    <div className="card flex flex-col p-6 text-left">
      <div className={`mb-4 grid size-11 place-items-center rounded-xl ${tile}`}>{icon}</div>
      <h2 className="mb-1.5 text-lg font-bold tracking-tight text-ink">{title}</h2>
      {children}
    </div>
  );
}

export default function FeatureCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card icon={<ClipboardPaste className="size-5" aria-hidden="true" />} tile="bg-success-bg text-brand" title="Paste & Check">
        <p className="text-ink">Just paste any URL on our homepage</p>
        <p className="mt-2 text-sm text-muted">Perfect for quick manual checks</p>
      </Card>
      <Card icon={<Link2 className="size-5" aria-hidden="true" />} tile="bg-blue-50 text-prefix" title="Add Prefix">
        <p className="text-ink">Add {siteConfig.domain}/ before any website</p>
        <p className="mt-1 break-all font-mono text-sm text-prefix">(e.g. {siteConfig.domain}/example.com)</p>
        <p className="mt-2 text-sm text-muted">Super handy for browser checks</p>
      </Card>
      <Card icon={<CodeXml className="size-5" aria-hidden="true" />} tile="bg-violet-50 text-api" title="Use Our API">
        <p className="text-ink">Automate Shopify lead qualification in your sales funnel</p>
        <p className="mt-2 text-sm text-muted">Perfect for CRM, Zapier, or n8n flows</p>
        <Link href="/api-docs" className="mt-auto pt-4 text-sm font-semibold text-api underline-offset-4 hover:underline">
          Get API Access →
        </Link>
      </Card>
    </div>
  );
}
