# ToolDeck BLR — deploy notes

Everything below is already wired into the code. This explains the few
host-side switches you need to flip.

## 0. Build
```bash
npm install
npm run build     # outputs dist/ — deploy that folder
```
Netlify/Vercel: build command `npm run build`, publish directory `dist`.

## 1. Set your real origin
- `src/lib/seo.js` → `SITE` constant
- `index.html`, `public/robots.txt`, `public/sitemap.xml`

## 2. SPA rewrite (already included)
Routing uses real paths like `/tool/utc` (History API). Deep links only work if
the host serves `index.html` for unknown paths:
- **Netlify** → `public/_redirects` handles it.
- **Vercel** → `vercel.json` handles it.
- **Nginx** → `try_files $uri /index.html;`
Legacy `#/tool/x` links still resolve, so old shares don't break.

## 3. Shareable result links
Tool inputs live in the query string, so a copied link reopens the exact
result. Try: `/tool/utc?st=09:00&a=24&u=hours&r=10`.

## 4. Search + social unfurl
`index.html` ships defaults; the app updates title/description/canonical/OG and
`SoftwareApplication` + `FAQPage` JSON-LD per tool at runtime
(`useDocumentMeta`). Social unfurlers don't run JS, so for per-tool OG cards
prerender `/` and each `/tool/*` route (e.g. `@prerenderer/rollup-plugin` or
your host's prerendering). The homepage unfurls correctly without it.

## 5. Installable PWA — already on
`public/manifest.webmanifest` + `public/sw.js` register automatically on HTTPS
(and localhost). Client-side tools (UTC, phone, price demo) work offline.
**Bump `CACHE` in `public/sw.js` whenever you deploy** (currently `tooldeck-v2`).

## 6. Speed-test server (optional, recommended)
`supabase functions deploy speedtest` gives you a first-party measurement
server: ?op=ping|down|up|meta with rate limits, discard-only uploads and a
server-side IP/ASN lookup (no keys in the frontend). Without it, the tool
measures against Cloudflare's public edge. Methodology: docs/SPEEDTEST.md.

## 7. Price alerts backend (optional feature)
`supabase/` contains the Edge Functions, migrations, and cron. Follow
`docs/PRICE_ALERTS.md`; copy `.env.example`, set `VITE_SUPABASE_URL` in the
front-end build env. Providers default to `mock`, so nothing sends by accident.

## 8. Visitor counter (optional)
Point `COUNTER_ENDPOINT` in `src/hooks/index.js` at a tiny API returning
`{ count }` (a 10-line Cloudflare Worker with KV works). Until then the footer
shows a friendly placeholder — never a fake number.

## 9. Server proxy for the Shopify checker (recommended for production)
The browser falls back to public read-only CORS proxies. For one-click checks
on your own infra, add a small proxy with URL validation, SSRF protection and
rate limiting, and use it first in `src/lib/shopify.js → fetchPageSource`.
