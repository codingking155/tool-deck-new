import type { Metadata } from "next";
import { CodeXml, Database, Gauge, Mail, ShieldCheck, Webhook, Workflow, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { siteConfig } from "@/site.config";
import { LIMIT_PER_DAY, LIMIT_PER_MINUTE } from "@/lib/ratelimit";
import CodeTabs from "@/components/docs/CodeTabs";
import CopyButton from "@/components/docs/CopyButton";
import JsonView from "@/components/docs/JsonView";
import Reveal from "@/components/docs/Reveal";
import TryItLive from "@/components/docs/TryItLive";

export const metadata: Metadata = {
  title: "API Documentation",
  description: `Check whether any website runs on Shopify with one GET request. Free ${siteConfig.brand} REST API for Zapier, n8n, Make and your CRM.`,
  alternates: { canonical: "/api-docs" },
};

const ENDPOINT = `${siteConfig.apiEndpoint}?url={website}`;
const EXAMPLE = `${siteConfig.apiEndpoint}?url=example.com`;

const EXAMPLE_RESPONSE = {
  input_url: "example.com",
  final_url: "https://www.example.com/",
  is_shopify: true,
  confidence: 0.95,
  shop_domain: "example.myshopify.com",
  detected_signals: ["body:cdn.shopify.com", "header:x-shopid"],
  headers_sample: { server: "cloudflare", "x-shopify-stage": "production" },
  elapsed_ms: 234,
  cached: false,
};

const TABS = [
  { label: "cURL", code: `curl "${EXAMPLE}"` },
  {
    label: "JavaScript (fetch)",
    code: `const res = await fetch("${siteConfig.apiEndpoint}?url=" + encodeURIComponent("example.com"));
const data = await res.json();

if (data.is_shopify) {
  console.log(\`Shopify store (\${data.confidence * 100}% confidence)\`, data.shop_domain);
}`,
  },
  {
    label: "Python (requests)",
    code: `import requests

res = requests.get("${siteConfig.apiEndpoint}", params={"url": "example.com"}, timeout=15)
data = res.json()

if data.get("is_shopify"):
    print(f"Shopify store ({data['confidence']:.0%} confidence)", data.get("shop_domain"))`,
  },
];

const FIELDS: [field: string, type: string, description: string, required: boolean][] = [
  ["input_url", "string", "The URL exactly as you sent it.", true],
  ["final_url", "string", "Where the homepage landed after following redirects.", true],
  ["is_shopify", "boolean", "true when confidence is 0.5 or higher.", true],
  ["confidence", "number", "0–0.95, rounded to two decimals. Sum of weighted signals.", true],
  ["shop_domain", "string | null", "The store's *.myshopify.com domain when it can be found.", false],
  ["detected_signals", "string[]", "Evidence found, e.g. header:x-shopid, body:Shopify.theme, endpoint:/cart.js.", true],
  ["headers_sample", "object", "Up to 8 non-sensitive response headers (server, cf-ray, x-shopify-stage, …).", true],
  ["elapsed_ms", "number", "Time taken to fetch the homepage, in milliseconds.", true],
  ["cached", "boolean", "true when served from cache. Add &fresh=1 to force a new check.", true],
];

const ERRORS: [status: string, code: string, meaning: string][] = [
  ["400", "invalid_url", "Missing, malformed, private or internal URL."],
  ["422", "unreachable", "DNS failure, refused connection, bad TLS or blocked by bot protection (see reason)."],
  ["429", "rate_limited", "Limit exceeded. Wait for the Retry-After header's seconds."],
  ["504", "timeout", "The site didn't respond within 8 seconds."],
  ["500", "internal", "Something failed on our side."],
];

const INTEGRATIONS: { name: string; icon: ReactNode; steps: string[] }[] = [
  {
    name: "Zapier",
    icon: <Zap className="size-5" aria-hidden="true" />,
    steps: [
      'Add a "Webhooks by Zapier" action and choose GET.',
      `Set the URL to ${siteConfig.apiEndpoint} with a query param url = your lead's website field.`,
      'Add a Filter step: continue only if "is_shopify" is true.',
    ],
  },
  {
    name: "n8n",
    icon: <Workflow className="size-5" aria-hidden="true" />,
    steps: [
      "Add an HTTP Request node with method GET.",
      `URL: ${siteConfig.apiEndpoint}, query parameter url = {{ $json.website }}.`,
      "Route with an IF node on {{ $json.is_shopify }}.",
    ],
  },
  {
    name: "Make",
    icon: <Webhook className="size-5" aria-hidden="true" />,
    steps: [
      'Add the HTTP "Make a request" module, method GET.',
      `URL: ${siteConfig.apiEndpoint}, query string url = the mapped website. Enable "Parse response".`,
      "Add a filter on is_shopify = true before your CRM module.",
    ],
  },
];

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-2xl font-bold tracking-tight text-ink">{children}</h2>;
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-16 px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-api/20 bg-violet-50 px-3 py-1 text-sm font-medium text-api">
          <CodeXml className="size-4" aria-hidden="true" /> RESTful API
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-brand sm:text-5xl">API Documentation</h1>
        <p className="mt-3 text-xl font-semibold text-ink">Want to automate lead qualification?</p>
        <p className="mt-1 text-muted">Integrate our API with Zapier, n8n, CRM tools.</p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2 text-sm font-medium text-ink">
          <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5">
            <Gauge className="size-4 text-brand" aria-hidden="true" /> &lt; 300ms response (cached)
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5">
            <ShieldCheck className="size-4 text-brand" aria-hidden="true" /> High uptime
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5">
            <Database className="size-4 text-brand" aria-hidden="true" /> Cached results
          </li>
        </ul>
      </header>

      <Reveal>
        <SectionTitle>Endpoint</SectionTitle>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#0d1714] p-4 shadow-lg">
          <span className="rounded-md bg-emerald-500 px-2 py-1 font-mono text-xs font-bold text-[#0d1714]">GET</span>
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-emerald-50">{ENDPOINT}</code>
          <CopyButton text={ENDPOINT} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Replace <code className="rounded bg-mint px-1 font-mono text-ink">{"{website}"}</code> with the domain you want to check.
        </p>
      </Reveal>

      <Reveal>
        <SectionTitle>Example Request</SectionTitle>
        <CodeTabs tabs={TABS} />
      </Reveal>

      <Reveal>
        <SectionTitle>Response Fields</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line bg-mint/60 text-ink">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Field</th>
                <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                <th scope="col" className="px-4 py-3 font-semibold">Description</th>
                <th scope="col" className="px-4 py-3 font-semibold">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {FIELDS.map(([field, type, desc, required]) => (
                <tr key={field}>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{field}</td>
                  <td className="px-4 py-3 font-mono text-api">{type}</td>
                  <td className="px-4 py-3 text-muted">{desc}</td>
                  <td className="px-4 py-3 text-ink">{required ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal>
        <SectionTitle>Example Response</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-[#0d1714] shadow-lg">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="font-mono text-xs text-white/70">200 OK · application/json</span>
            <CopyButton text={JSON.stringify(EXAMPLE_RESPONSE, null, 2)} />
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-emerald-50">
            <code>
              <JsonView value={EXAMPLE_RESPONSE} />
            </code>
          </pre>
        </div>
        <h3 className="mb-3 mt-8 text-lg font-semibold text-ink">Errors</h3>
        <p className="mb-3 text-sm text-muted">
          Errors are always JSON: <code className="rounded bg-mint px-1 font-mono text-ink">{'{ "error": "timeout", "message": "…" }'}</code>
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="border-b border-line bg-mint/60 text-ink">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">error</th>
                <th scope="col" className="px-4 py-3 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ERRORS.map(([status, code, meaning]) => (
                <tr key={code}>
                  <td className="px-4 py-3 font-mono text-ink">{status}</td>
                  <td className="px-4 py-3 font-mono text-api">{code}</td>
                  <td className="px-4 py-3 text-muted">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal>
        <SectionTitle>Try it live</SectionTitle>
        <TryItLive />
      </Reveal>

      <Reveal>
        <SectionTitle>Integration Examples</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {INTEGRATIONS.map((it) => (
            <div key={it.name} className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-lg bg-violet-50 text-api">{it.icon}</span>
                <h3 className="font-bold text-ink">{it.name}</h3>
              </div>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted marker:font-semibold marker:text-api">
                {it.steps.map((s) => (
                  <li key={s} className="break-words">{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">
          Checking a list? <code className="rounded bg-mint px-1 font-mono text-ink">POST {siteConfig.apiEndpoint}/bulk</code> with{" "}
          <code className="rounded bg-mint px-1 font-mono text-ink">{'{ "urls": [...] }'}</code> (up to 50, each counts toward your limits).
        </p>
      </Reveal>

      <Reveal>
        <SectionTitle>Rate Limits</SectionTitle>
        <div className="card p-5">
          <p className="text-ink">Free with reasonable limits; may become paid depending on usage.</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>{LIMIT_PER_MINUTE} requests per minute per IP</li>
            <li>{LIMIT_PER_DAY.toLocaleString("en-US")} requests per day per IP</li>
            <li>Results are cached (24h for Shopify stores, 6h otherwise), so repeat checks are fast and cheap</li>
            <li>
              Every response includes <code className="font-mono text-ink">X-RateLimit-Limit</code>,{" "}
              <code className="font-mono text-ink">X-RateLimit-Remaining</code> and <code className="font-mono text-ink">X-RateLimit-Reset</code>
            </li>
          </ul>
        </div>
      </Reveal>

      <Reveal className="card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Need higher limits or custom integration?</h2>
        <p className="mt-2 text-muted">Tell us about your volume and workflow — we&apos;ll set you up.</p>
        <a
          href={`mailto:${siteConfig.email}?subject=${encodeURIComponent(`${siteConfig.brand} API access`)}`}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-hover"
        >
          <Mail className="size-4" aria-hidden="true" /> Contact Us
        </a>
      </Reveal>
    </div>
  );
}
