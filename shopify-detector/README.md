# StoreScout — Shopify Store Detector

Instantly tells you whether any website is built on Shopify. Built for B2B sales teams that sell Shopify apps and need to qualify leads fast: a web checker, a `/<domain>` prefix shortcut, and a free public JSON API for Zapier, n8n, Make and CRMs.

> **Rebranding:** every brand, domain, email and GitHub value lives in [`site.config.ts`](./site.config.ts) (plus the env vars below). Change it there; nothing else hard-codes them.

## Features

- **Checker UI** with loading skeleton, three result states (Shopify / not Shopify / error), confidence meter, platform/SSL/speed tiles, expandable technical details (signals + headers), copy/visit actions and shareable URLs (`/?url=example.com`).
- **Prefix route** — `https://your-site/allbirds.com` auto-runs a check. Result pages are `noindex` by default.
- **Detection engine** (`lib/detect.ts`) — weighted header, cookie, body and endpoint signals; confidence 0–0.95; `is_shopify` at ≥ 0.5.
- **Public API** — `GET /api/check?url=` (also `https://api.<domain>/check`) and `POST /api/check/bulk`, with caching, rate limits, CORS and JSON errors.
- **API docs** page with code tabs, response/field tables, integration guides and a live "Try it" box.
- **Story + blog** from MDX files in `content/`, with table of contents, related posts and an inline CTA.
- **SEO** — per-page metadata, canonical URLs, generated OG images, JSON-LD (`WebApplication`, `Article`), `sitemap.xml`, `robots.txt`.
- **Analytics** — Vercel Analytics `check_performed` event with `result: shopify | not_shopify | error`.

## Getting started

```bash
cd shopify-detector
cp .env.example .env.local   # optional — everything has a local fallback
npm install
npm run dev                  # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Vitest unit tests (normalization, SSRF blocking, scoring, cache, rate limits, prefix parsing) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | In production | Public site URL (canonical URLs, OG images, sitemap, prefix instructions). Defaults to `http://localhost:3000`. |
| `NEXT_PUBLIC_API_HOST` | No | API subdomain, e.g. `api.example.com`. Changes the endpoint shown in the docs. |
| `GITHUB_REPO` | No | `owner/name` for the Star button and live star count (refreshed hourly, falls back to `fallbackStars`). |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis REST token. |

Without Upstash, caching and rate limiting use an in-memory LRU **per server instance** — fine locally, but on serverless each instance keeps its own counters. Set both Upstash variables in production.

## How detection works

1. **Normalize** the input (`example.com`, `www.example.com`, `https://example.com/path`) to `https://host/`. IP literals, custom ports, `localhost` and internal suffixes are rejected.
2. **SSRF protection** — the host is resolved up front, and every socket connection (including each redirect hop) goes through a DNS lookup that refuses loopback, RFC 1918, CGNAT, link-local/metadata (`169.254.169.254`), multicast, reserved and IPv6 ULA/link-local ranges, including IPv4-mapped and NAT64 forms. This also defeats DNS rebinding.
3. **Fetch** the homepage with a browser User-Agent, manual redirect following (max 5, http/https on ports 80/443 only), an 8 s timeout and a 2 MB body cap. If HTTPS is refused or has a bad certificate, retry over HTTP.
4. **Score signals.** Headers across all redirect hops (`x-shopid`, `x-shopify-stage`, `x-sorting-hat-*`, `powered-by: Shopify`, `x-shardid`, Shopify cookies) and body markers (`window.Shopify`, `Shopify.theme`, `cdn.shopify.com`, `/cdn/shop/`, `shopify-digital-wallet`, …). Body markers are matched only in scripts, styles and attribute values — never visible text — so an article *about* Shopify isn't flagged.
5. **Probe** `/cart.js` then `/products.json?limit=1` when the score is below 0.5; a valid Shopify JSON shape adds 0.3.
6. **Report** confidence (capped at 0.95), `shop_domain` (from `Shopify.shop` or the most frequent `*.myshopify.com`), signals and a safe allowlist of headers. Bot-protection pages with no signals are reported as `unreachable` / `blocked`, not as "not Shopify".

Weights live in [`lib/detect/signals.ts`](./lib/detect/signals.ts).

## API

```bash
curl "https://your-site/api/check?url=example.com"
```

- Results are cached per host: **24 h** for Shopify, **6 h** otherwise, never for errors. `&fresh=1` bypasses the cache.
- Limits: **60/min** and **1000/day** per IP. Every response has `X-RateLimit-Limit/Remaining/Reset`; `429` responses add `Retry-After`.
- Errors: `400 invalid_url`, `422 unreachable` (with `reason`: `dns`, `refused`, `tls`, `blocked`, `http_error`, `network`), `429 rate_limited`, `504 timeout`, `500 internal`.
- `POST /api/check/bulk` with `{ "urls": [...] }` — up to 50 URLs, 5 at a time; each URL counts toward the limits.

Full docs: `/api-docs`.

## Content

- `content/the-story.mdx` — the origin story (placeholder — write your own).
- `content/blog/*.mdx` — posts. Frontmatter: `title`, `description`, `date`, `author` (defaults to `siteConfig.author`), `readTime`, `tags`, `featured`. Use `<CheckCta />` for the inline CTA box.

## Deploying to Vercel

This app lives in the `shopify-detector/` folder of a larger repository.

1. Import the repository in Vercel and set **Root Directory** to `shopify-detector`.
2. Add the environment variables above (at least `NEXT_PUBLIC_SITE_URL`, plus the Upstash pair).
3. **API subdomain:** add `api.<your-domain>` as a second domain on the **same** project. `next.config.ts` rewrites `/check` and `/check/bulk` on any `api.*` host to the API routes, and redirects the bare `api.` root to `/api-docs`. Set `NEXT_PUBLIC_API_HOST` so the docs show the subdomain.
4. Enable Vercel Analytics in the project settings to receive `check_performed` events.

Rate limiting keys on the first `x-forwarded-for` address, which Vercel sets from the real client. Behind a different proxy, make sure it overwrites that header.
