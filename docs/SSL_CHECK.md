# SSL Certificate Checker

Browsers can't open raw TLS connections or read another site's certificate, so
the tool calls the `ssl-check` Edge Function:

```
GET {VITE_SUPABASE_URL}/functions/v1/ssl-check?host=example.com
→ { host, checked_at,
    tls: { ok, status, message, ms },
    ct:  { status: "found" | "none" | "unavailable", source: "crt.sh", certificate } }
```

- **`tls`** — a live handshake to `host:443`, verified by the runtime's trust store
  (`Deno.connect` to the resolved, range-checked address, then `Deno.startTls` with
  SNI = host). `ok: true` means the served chain is trusted, unexpired and issued for
  that name. Failures map to `expired`, `not_yet_valid`, `hostname_mismatch`,
  `untrusted` (self-signed / unknown issuer / incomplete chain), `revoked`,
  `unreachable`, `handshake_failed` or `error`, as far as the runtime's error text allows.
- **`ct.certificate`** — issuer, common name, SANs, `notBefore`/`notAfter`, serial and
  crt.sh id of the **most recently issued, currently valid certificate for the name in
  Certificate Transparency logs** (crt.sh, queried for the host and its wildcard
  parent). It is usually, but not always, the certificate the server presents (CDNs
  and load balancers may serve another); the UI labels it that way. crt.sh is slow and
  sometimes down: `unavailable` is reported as such, never as "no certificate".

Guards: input is normalised and validated in `shared/sslCore` (scheme/path/port
stripped, IPs and internal names refused); every resolved address is checked with
`shared/net/ipGuard` and the TCP connection goes to that checked address, so the
function can't probe private networks or be DNS-rebound. 20 checks/min per IP
(`sharedRateLimit`, shared across instances). Connect 5 s, handshake 6 s, CT 10 s.

Pure helpers (normalisation, CT record selection, date parsing, expiry severity,
TLS error mapping) are unit-tested in `tests/ssl-core.test.mjs`.

## Deploy

No secrets are needed. Deployed by `.github/workflows/supabase-deploy.yml` with the
other JWT-verified functions, or manually:

```bash
supabase functions deploy ssl-check
```

The frontend sends the anon key like the Shopify detector, so it needs only
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at build time. Outbound access to
`crt.sh:443` and to arbitrary hosts on port 443 must be allowed (it is on hosted Supabase).
