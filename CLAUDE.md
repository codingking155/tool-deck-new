# ToolDeck

Vite + React 18 SPA (`src/`), Supabase Edge Functions (`supabase/functions/`, Deno) sharing pure
modules in `shared/`, and a standalone Next.js app in `shopify-detector/` (own Vercel project).

## Commands
- `npm run check` — quiet tests + build (prints only failures). Run before every commit. Use this, not `npm test`,
  unless you need per-test names (`npm test`).
- `npx vite preview --port 4173` to browse a build; `npm run preview:csp` serves it with vercel.json's CSP/security
  headers (run e2e against that after touching anything that loads/fetches a new origin, then update the CSP).
- e2e: `npm run e2e -- <filter…>` (e.g. `npm run e2e -- pdf ip`) builds like CI, serves with the CSP, runs only the
  matching scenarios, prints just failures + summary, and stops the server. No args = whole suite (~5 min); run
  it only before merging or when a change is app-wide. Raw `p.mouse` drawing must emulate reduced motion
  (decorative spiders swallow pointerdown).
- Edge functions have no local runner; type-check with Deno in a scratch copy (esm.sh is blocked here).
- Deploy: `.github/workflows/supabase-deploy.yml` (needs repo secrets) — see `docs/PRICE_TRACKER.md`.

## Conventions
- Theme: dark is default, `.light` class on `.app`; use the `--tx/--panel/--line/--good/--warn/--bad` tokens,
  never hard-coded colours (text on fixed pastel backgrounds broke dark mode before).
- Price Tracker shows REAL data only. No sample/seeded/fallback prices; if no live price, show
  "Unable to retrieve the latest price right now."
- Never put secrets in frontend code. Provider keys live in Supabase secrets.
- Define React components at module scope (the UTC/Phone tools and header clocks re-render every second; inner
  components remount). Keep per-second state in small leaf components, never in `App`.
- Accent tokens are contrast-checked (light `--pri2/--good/--bad/--warn` >=4.5:1 on panels and their 12% tints;
  `--line-strong` >=3:1 for form-control borders). Tints: `color-mix(in srgb,var(--good) 12%,transparent)`, not rgba.
- The old 18-signal `shopify` tool was removed; `shopifydetector` is the only Shopify tool. Its detection engine (`shared/shopifyCore`) and the `shopify-check` edge function remain as an API.
- Bottom of the page: spiders yes, cobwebs no.
- Git: develop on the branch named in the session; commit messages end with the Co-Authored-By /
  Claude-Session lines given by the harness; don't open PRs unless asked.

## Working efficiently (token use)
- Read only the files/lines needed; prefer Grep over reading whole files. Don't read `node_modules`, `dist`,
  `shopify-detector/.next`, lockfiles or fonts.
- Delegate wide searches or reviews to a subagent so only the conclusion returns.
- Don't schedule recurring check-ins or PR subscriptions unless asked; stop them once the PR is green.
- Keep final replies short; put detail in commit messages / PR descriptions.
- Long jobs: run in the background and wait for the completion notice once; don't poll, `sleep`-loop or stream
  logs with Monitor. Read outputs through `tail`/`grep`, never whole logs.
- Debug flaky tests by capturing the failing locator + a screenshot on the first failure, not by re-running blindly.
