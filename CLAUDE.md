# ToolDeck

Vite + React 18 SPA (`src/`), Supabase Edge Functions (`supabase/functions/`, Deno) sharing pure
modules in `shared/`, and a standalone Next.js app in `shopify-detector/` (own Vercel project).

## Commands
- `npm run check` — quiet tests + build; the local gate before every commit (`npm test` only for per-test names).
- `npm run preview:csp` serves a build with vercel.json's CSP; a new fetched/loaded origin needs a CSP update there.
- e2e (`npm run e2e -- <filter…>`): NEVER run it unless the user asks in that session — CI runs the suite.
  Raw `p.mouse` drawing in e2e must emulate reduced motion (decorative spiders swallow pointerdown).
- Edge functions have no local runner; type-check with Deno in a scratch copy (esm.sh is blocked here).
- Deploy: `.github/workflows/supabase-deploy.yml` (needs repo secrets) — see `docs/PRICE_TRACKER.md`.

## Conventions
- Theme: dark is default, `.light` class on `.app`; use tokens only (semantic `--surface/--text-*/--brand/--success…`
  or legacy aliases `--tx/--panel/--line/--good/--warn/--bad`), never hard-coded colours. See `docs/DESIGN_SYSTEM.md`.
- Global primitives live in `src/styles.css`; tool-only CSS goes in `src/tools/css/<tool>.css`, imported by the tool
  (ships with its lazy chunk). Shared UI: `src/components/ui.jsx` (PrivacyBadge, Notice, CopyButton, EmptyState…).
- `tool.where` is the privacy taxonomy: `device | tooldeck | external | mixed` (labels in `WHERE_LABEL`).
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
- Read only the lines needed; Grep before Read. Build output, deps, lockfiles and fonts are read-blocked in settings.
- Delegate wide searches or reviews to a subagent so only the conclusion returns.
- No recurring check-ins or PR subscriptions unless asked.
- Long jobs: background them and wait for the one completion notice; no polling, sleep loops or Monitor log
  streams. Read output via `tail`/`grep`.
- Screenshots only for a visual change: at most one, of the element (`locator.screenshot`), never full-page.
- Flaky test: capture the failing locator + one screenshot on the first failure; don't re-run blindly.
- Keep replies short; detail goes in commit messages / PR descriptions.
