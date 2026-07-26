# ToolDeck BLR v2 — super codebase

Six fast, private browser utilities: UTC Wait-Time Generator · Phone → Country ·
Shopify Detector · Speed Test · IP & IPv6 · Price Tracker (with real
email/WhatsApp price alerts via Supabase).

## Quick start

```bash
npm install
npm run dev        # local dev server with HMR
npm run build      # production build → dist/
npm run preview    # serve the production build locally
npm test           # 30 node tests (time core + price-alert core)
```

## Architecture

```
src/
├── main.jsx                  entry — mounts App, registers the service worker
├── App.jsx                   shell: header, routing, lazy tool routes, palette, toast
├── styles.css                single build-hashed stylesheet (design tokens on :root;
│                             .light only overrides tokens)
├── toolsMeta.js              the tool registry — the ONE place a tool is declared
│                             (name, colour, blurb, FAQs → visible section + JSON-LD)
├── lib/                      pure logic, zero React — all unit-testable in node
│   ├── time.js               audited v2 UTC scheduler core (DST-safe conversion,
│   │                         weekend-aware send resolution, transition warnings)
│   ├── phone.js              dial-code trie + NANP overlay → O(len) detection
│   ├── timezones.js          Intl-derived zone index with pre-lowercased search
│   ├── shopify.js            nine-signal scoring engine + proxy-fallback fetcher
│   ├── speed.js              Cloudflare-edge speed engine + labelled demo run
│   ├── priceDemo.js          seeded deterministic demo price history
│   └── seo.js                dynamic <head> primitives (meta/canonical/JSON-LD)
├── hooks/index.js            useNow, useReducedMotion, useRoute, URL-state,
│                             useDocumentMeta, useCountUp, useIpLocale, useVisitCount
├── components/               shared UI (ZonePicker, Ambient FX, palette, clock, footer)
├── pages/Home.jsx            hero + bento grid
├── tools/                    one file per tool — each is its own lazy chunk
└── features/priceAlerts/     alert dialog, My Alerts page, edge-function client

shared/priceAlertsCore/       isomorphic alert logic (validation, tokens, templates)
supabase/                     Edge Functions + SQL migrations + cron for alerts
tests/                        node --test suites (time core, validation, monitor)
```

### Performance model

- **Route-level code splitting.** First paint ships the shell + home (~15 KB gz
  app code). Each tool loads on demand (1–4 KB gz each); React lives in a
  separately cached `vendor` chunk. The price-alert dialog loads only when opened.
- **Real CSS asset** instead of a runtime-injected `<style>` string — parsed
  once, cached by hash, and theme switching only flips CSS custom properties.
- **No layout-thrashing animations.** Everything animates `transform`/`opacity`;
  the card tilt writes CSS variables directly (no React re-render); the particle
  canvas pauses on hidden tabs and disappears entirely under
  `prefers-reduced-motion`.
- **Cached Intl formatters** (one per timezone) and a compiled dial-code trie —
  every keystroke stays O(input length).
- **PWA**: app shell precached (`public/sw.js`, cache `tooldeck-v2` — bump on
  deploy), client-side tools work offline.

### The time core is the audited one

`src/lib/time.js` is the audited v2 scheduler (`utc-scheduler-core.js`)
integrated as the single source of truth. The order → notification mode now
uses `getNextValidSendUtc` (configurable weekend basis, reported skipped days)
and surfaces `getDateTimeWarning` when an input falls inside or near a DST
transition. `tests/time-core.test.mjs` locks in the primary requirement
(Friday 18:00 order → Monday send) and the DST edge cases.

## Deploying

See `DEPLOY.md`. Price alerts additionally need the Supabase setup described in
`docs/PRICE_ALERTS.md` and the environment in `.env.example`.
