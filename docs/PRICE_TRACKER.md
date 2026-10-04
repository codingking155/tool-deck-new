# Price Tracker — real data

Paste an Amazon product link → live price, product details, and price history
built **only from real readings**. There is no demo, seeded, sample or fallback
price anywhere in the product path; if a live price can't be read the UI says
"Unable to retrieve the latest price right now." and shows nothing invented.

## Flow

```
pasted link ─▶ parseProductUrl()  (shared/priceTrackerCore/amazonUrl.mjs)
             │   affiliate/tracking params, mobile hosts, /gp/aw/d, /-/hi/dp,
             │   /gp/product … all → marketplace + ASIN;  amzn.in / amzn.to / a.co
             │   short links are expanded server-side (redirects only, allowlisted hosts)
             ▼
   tracked_products (unique marketplace + ASIN)
             ▼
   live price ─ Amazon Product Advertising API 5.0 GetItems (signed SigV4)
             │   fallback only if PA-API is unset / temporarily failing:
             │   Keepa's latest reading, with Keepa's own timestamp
             ▼
   price_observations  ← append-only, real observed_at + source
             ▼
   UI: current price, "as of" time, lowest / highest / time-weighted average,
       change over range, step-line chart, readings table, alerts
```

Every 5 minutes `check-price-alerts` (pg_cron) refreshes due products — every
6 h normally, hourly while an active alert watches them, sooner after a
transient failure — then evaluates alerts against those readings.

## Data sources (configure at least one)

| Source | What it provides | Env |
|---|---|---|
| **Amazon PA-API 5.0** (official) | live price, title, image, availability, seller, affiliate product link | `AMAZON_PAAPI_ACCESS_KEY`, `AMAZON_PAAPI_SECRET_KEY`, `AMAZON_PAAPI_PARTNER_TAG` (amazon.in) or `AMAZON_PAAPI_PARTNER_TAGS` (JSON per marketplace), optional `AMAZON_PAAPI_OFFERS_VERSION=v1` |
| **Keepa** (licensed, optional) | genuine historical prices, imported once per product with original timestamps (`keepa-amazon` / `keepa-new`) | `KEEPA_API_KEY` |

`PRICE_TRACKER_MARKETPLACES` (default `amazon.in`) limits which Amazon locales
are accepted. With **no** provider configured, lookups return `503 not_configured`
and the UI shows the unavailable message — there is intentionally no other path.

Tuning: `PRICE_CHECK_INTERVAL_MINUTES` (360), `PRICE_ALERT_CHECK_INTERVAL_MINUTES`
(60), `PRICE_CHECK_RETRY_MINUTES` (30), `PRICE_MIN_REFRESH_MINUTES` (10 — on-demand
lookups reuse a check this recent), `PRICE_LOOKUP_RATE_LIMIT_MAX` (30/min/IP).

### Compliance notes — read before enabling

- PA-API access requires an approved Amazon Associates account, and Amazon throttles
  (and can revoke) accounts by referred sales. Product links use the API's
  `DetailPageURL`, and the UI shows the price timestamp plus Amazon's
  "accurate as of the time shown" disclaimer.
- **The PA-API license restricts storing and displaying Product Advertising Content
  over time.** Keeping PA-API prices as long-term history may not be permitted under
  your agreement — check the current license before relying on it. Keepa is a
  provider licensed for price history; with `KEEPA_API_KEY` set, history comes from
  there.
- No scraping: Amazon product pages are never fetched. Short links are resolved by
  reading redirect `Location` headers from the short-link hosts only.

## Schema (`supabase/migrations/20260928000000_price_tracker_real_data.sql`)

- `tracked_products` — identity (`marketplace`, `external_id`/ASIN, generated
  `product_key`), canonical/affiliate URLs, title, image, currency, current state
  (price, original price, availability, seller, `last_observed_at`), check status,
  scheduling (`next_check_at`, `last_requested_at`), `history_imported_at`.
- `price_observations` — append-only time series; `price` null = unavailable at that
  moment; unique `(product_id, observed_at, source)` makes imports idempotent.
- `price_alerts` — the existing watchlist, now with `tracked_product_id`.
  Alerts are created only for a looked-up product; name/image/currency/"was" price
  come from `tracked_products`, not from the client.
- `claim_due_products()` — `FOR UPDATE SKIP LOCKED` batch lease, same pattern as
  `claim_due_alerts()`. Products nobody viewed for 90 days and no active alert
  watches drop off the schedule.

**Legacy rows.** Alerts created before this change were set against the old
simulated prices: the migration clears their stored "original price", and the
monitor links each one to its real product on its next run (or pauses it with a
`last_error` explaining why, when its URL isn't a trackable Amazon product).

## Recording rules (`shared/priceTrackerCore/series.mjs`)

A reading becomes a new observation when price, availability or seller changed, or
the last stored one is ≥ 24 h old (a daily confirmation point). Otherwise only
`last_observed_at` advances. Observations are never updated or overwritten.
Averages are time-weighted over the step series; a verdict ("lower than usual",
"lowest recorded") only appears with ≥ 14 days and ≥ 3 readings.

## Deploy

```bash
supabase db push
supabase secrets set AMAZON_PAAPI_ACCESS_KEY=… AMAZON_PAAPI_SECRET_KEY=… AMAZON_PAAPI_PARTNER_TAG=…-21
# optional history: supabase secrets set KEEPA_API_KEY=…
supabase functions deploy price-tracker price-alerts
supabase functions deploy check-price-alerts --no-verify-jwt   # pg_cron sends no JWT; guarded by CRON_SECRET
```

Or let GitHub do it: `.github/workflows/supabase-deploy.yml` runs `db push`, syncs the
provider secrets and deploys every function on each push to `main` that touches
`supabase/` or `shared/` (or on demand from the Actions tab). Add repository secrets
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, plus the
`AMAZON_PAAPI_*` / `KEEPA_API_KEY` values you want synced.

Front-end needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at build time.

## Tests

`npm test` — `tests/price-tracker.test.mjs` covers URL normalization, short links,
the AWS SigV4 reference vector, PA-API V1/V2 parsing and errors, Keepa parsing,
provider fallback / not-configured, recording rules, stats, and the full lookup →
store → refresh flow against an in-memory repo. Network is mocked in tests only.
