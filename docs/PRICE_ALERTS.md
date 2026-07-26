# Target Price Alerts (Beta)

Lets a customer set a target price on a product and get an **email** and/or
**WhatsApp** notification when `current_price <= target_price`. Signed-in customers
manage alerts from their account; guests manage via a secure, unguessable link.

> **Honest scope.** ToolDeck is a front-end SPA with no real product catalog — its
> Price Tracker uses a seeded *demo* price source. This feature is built as a
> self-contained Supabase module (Postgres + Auth + Edge Functions + pg_cron) and
> wired into the Price Tracker as the "product page." The current price is read
> through one injectable seam, `getCurrentPrice`, which today calls the demo
> generator. **Swap that one function** (or pass your own into the monitor) to go
> live against a real catalog — nothing else changes.

## 1. Files

**Database**
- `supabase/migrations/20260719000000_price_alerts.sql` — enums, `price_alerts` +
  `price_alert_deliveries` tables, constraints (target > 0, ≥1 channel, contact
  present), partial unique index preventing duplicate **active** alerts, RLS, the
  `claim_due_alerts()` locking function, `updated_at` trigger.
- `supabase/migrations/20260719000100_price_alerts_cron.sql` — pg_cron schedule.

**Shared core (framework-agnostic, used by functions + UI + tests)** — `shared/priceAlertsCore/`
- `validation.mjs` `pricing.mjs` `trigger.mjs` `retry`(in `trigger.mjs`) `links.mjs`
  `templates.mjs` `tokens.mjs` `providersMock.mjs` `deliver.mjs` `processAlert.mjs`

**Edge Functions (Deno)** — `supabase/functions/`
- `price-alerts/` — CRUD + pause/reactivate (auth JWT or guest token).
- `price-alerts-unsubscribe/` — token-verified opt-out (+ friendly HTML page).
- `check-price-alerts/` — the scheduled monitor (idempotent; locking; retries).
- `_shared/` — http/CORS/redaction, Supabase clients, rate limit, provider factory,
  real providers (`email/resend.ts`, `whatsapp/meta.ts`).

**Front-end** — `src/features/priceAlerts/`
- `api.js` `SetPriceAlert.jsx` `MyAlerts.jsx` `styles.js`
- Integrated into `src/ToolDeck.jsx`: "Set price alert (Beta)" on the Price Tracker,
  and a `/tool/price/alerts` management route.

**Tests** — `tests/validation.test.mjs`, `tests/monitor.test.mjs` (`npm test`).

## 2. Database migration

```bash
supabase db push          # applies both migrations
# or run the .sql files against your Postgres in order
```

## 3. Environment variables

See `.env.example`. Set the server vars as Edge Function secrets:

```bash
supabase secrets set ALERT_TOKEN_SECRET=... CRON_SECRET=... \
  EMAIL_PROVIDER=mock WHATSAPP_PROVIDER=mock APP_BASE_URL=https://tooldeck.in
# switch to real delivery when ready:
#   EMAIL_PROVIDER=resend  RESEND_API_KEY=...  EMAIL_FROM="..."
#   WHATSAPP_PROVIDER=meta  WHATSAPP_TOKEN=...  WHATSAPP_PHONE_NUMBER_ID=...
```

Front-end needs `VITE_SUPABASE_URL` at build time.

Deploy the functions:

```bash
supabase functions deploy price-alerts price-alerts-unsubscribe check-price-alerts
```

> The functions import the shared core via `../../../shared/priceAlertsCore/*.mjs`
> (repo root). Deploy from the repo root so the bundler includes it. If your CLI
> version won't bundle files above the function folder, copy `shared/priceAlertsCore`
> into `supabase/functions/_shared/core` and update the three import paths.

## 4. Running the price-check job

**Scheduled (recommended):** apply `..._cron.sql`, then set the two settings it reads:

```sql
select set_config('app.functions_url', 'https://<ref>.functions.supabase.co', false);
select set_config('app.cron_secret',   '<CRON_SECRET>', false);
```

It POSTs to `/check-price-alerts` every 5 minutes. You can also use the Supabase
Dashboard → **Edge Functions → Schedules** instead of pg_cron.

**Manual run (dev/testing):**

```bash
curl -X POST "$FUNCTIONS_BASE/check-price-alerts" \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"batch":100}'
```

The job **claims** due alerts atomically (`FOR UPDATE SKIP LOCKED`), so overlapping
runs never process the same alert. Already-triggered alerts are skipped, so it is
safe to run repeatedly (idempotent). Failed sends are recorded in
`price_alert_deliveries`, the alert stays active, and it retries with exponential
backoff up to 5 attempts.

## 5. Testing email & WhatsApp

- With `EMAIL_PROVIDER=mock` / `WHATSAPP_PROVIDER=mock`, no external calls are made;
  sends are recorded in memory and logged (PII redacted). This is what the unit
  tests exercise — see `tests/monitor.test.mjs` for delivery, idempotency,
  WhatsApp-outage fallback, and retry cases.
- Force a trigger in dev by creating an alert with a target **above** the demo
  current price, then run the job manually (step 4).
- Real providers: set `EMAIL_PROVIDER=resend` (+`RESEND_API_KEY`) and/or
  `WHATSAPP_PROVIDER=meta` (+ token, phone-number id, optional approved template).

Run the pure-logic suite:

```bash
npm test
```

## 6. Beta limitations

- **Demo price source.** Current price comes from ToolDeck's seeded generator, not a
  live catalog. Replace `getCurrentPrice` / `shared/priceAlertsCore/pricing.mjs`.
- **Rate limiting is per-instance** (in-memory). For strict global limits, back it
  with Postgres or Redis.
- **WhatsApp** requires an approved Meta template for out-of-session sends; without
  one, plain-text messages only work inside the 24-hour customer service window.
- **Auth binding.** Signed-in flows expect Supabase Auth and an optional `profiles`
  table for phone. If your app uses a different auth/customer store, adapt
  `userFromRequest` and the profile lookup in `price-alerts/index.ts`.
- Guest management links carry the token in the URL; treat them as secret. Tokens
  are stateless HMACs — rotating `ALERT_TOKEN_SECRET` invalidates all of them.
