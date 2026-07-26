# ToolDeck speed test — methodology, security, and limitations

## Formulas (all unit-tested in `tests/speed-core.test.mjs`)

**Idle latency.** 12 small uncached probes (`?bytes=0` + random cache-buster).
Failed probes (timeout/network error) are removed; outliers beyond
2.5 × MAD × 1.4826 of the median are removed; the reported value is the
**median** of what remains.

**Jitter.** Mean absolute successive difference of the cleaned samples
(RFC 3550 flavour): `Σ|RTTᵢ − RTTᵢ₋₁| / (n−1)`. Not standard deviation.

**Throughput (down and up).** Every received/confirmed chunk is recorded as
`{t, bytes}`. Live display uses a trailing **sliding window**:
`Mbps = Σbits(window) / windowSeconds`, with the boundary sample anchoring
time but contributing no bytes. The final figure uses
`finalMbps`: the first **10 % of wall time is excluded** (TCP slow-start and
connection warm-up), then `Σbits / activeSeconds` over the remainder.
Download reads streamed `response.body` chunks over up to 4 parallel
connections with progressive payloads (1 → 10 → 25 → 50 MB, 12 s max).
Upload sends `crypto.getRandomValues` payloads (1 → 5 → 10 MB, 3 streams,
10 s max) and counts only bytes whose response completed.

**Loaded latency.** The idle prober keeps running (every 250 ms) during the
download stage and separately during the upload stage; each reports its own
median. Loaded ≫ idle indicates bufferbloat, which the UI calls out.

**Packet loss.** Displayed as **Unavailable** — deliberately. Browser HTTP
runs over TCP (or QUIC), which retransmits lost packets invisibly; a probe
failure count is *not* packet loss and reporting it as such would be
fabrication. Honest loss measurement needs a UDP-like path (WebRTC/TURN
infrastructure), listed under future work.

**Data budget.** A shared byte counter caps the whole run near 200 MB; the
UI warns before starting.

## Server selection

`availableServers()` lists Cloudflare's edge (anycast → nearest city, shown
via colo code) and, when `VITE_SUPABASE_URL` is configured, the ToolDeck
server. "Auto" probes each 3× and picks the lowest healthy median; a
dropdown allows manual override. The selected server's identity is stored
with every result. **Server location and user location are separate fields
end-to-end.**

## Connection panel

Populated from the measurement server's metadata endpoint (Cloudflare
`/meta`, or ToolDeck `?op=meta` which reads `x-forwarded-for` server-side
and consults an IP-intelligence service with a 4 s timeout). Fields: IP,
IPv4/IPv6, approximate city/region/country, ASN, organization. Lookup
failure never blocks the test — fields show "Unavailable". No browser GPS.
The panel explains why the IP is processed. No API keys exist in frontend
code (the ToolDeck lookup happens server-side).

## Security and privacy checklist

- [x] Download responses capped (50 MB/request), `no-store, no-transform`, `Content-Encoding: identity`
- [x] Upload bodies capped (50 MB), **counted then discarded** — never written to storage
- [x] Per-IP token bucket (60 req/min) on the ToolDeck endpoint
- [x] CORS restricted via `ALLOWED_ORIGIN`
- [x] All query input validated/clamped server-side
- [x] Server logs contain **truncated** IPs only (`a.b.x.x` / first hextets)
- [x] Results stored **only** in the browser (localStorage), exported only by user action
- [x] No analytics events carry results or IPs (there are no analytics calls at all)
- [x] Clear-history control; copy/CSV/JSON export are explicit user actions
- [x] Privacy Policy and Terms links in the site footer

## Error handling map

offline → dedicated state with auto-recovery listener · all-probes-failed →
failed state naming the server · blocked endpoints (ad-blockers) → failed
state suggesting allow-listing or another server · partial transfer →
result kept, missing stage shows Unavailable with a "partial" banner ·
cancel → aborts every in-flight fetch via one AbortController · hidden tab
during test → result flagged as a lower bound (browsers throttle background
tabs) · metadata failure → panel-only degradation.

## Accessibility

Stage changes announced via an `aria-live="polite"` status region; all
controls are native buttons/selects (keyboard operable, visible
`:focus-visible` ring site-wide); pass/fail rows pair ✓/✕ glyphs with text
(never color alone); the progress bar is `aria-hidden` with the stage text
carrying the information; `prefers-reduced-motion` disables bar transitions
and all ambient animation.

## Known limitations and assumptions

1. Single-stream fairness: 4 download / 3 upload streams approximate, not
   replicate, Ookla's many-stream burst — expect slightly lower numbers on
   very fast links.
2. `performance.now()` timing includes browser scheduling; on a busy device
   the measurement is a lower bound.
3. Upload confirmation timing includes the response round-trip; on
   high-latency links this understates upload slightly.
4. Cloudflare colo ≠ guaranteed nearest ISP server; TRAI/Ookla may pick an
   in-ISP server and read higher.
5. IP geolocation is approximate by nature and labelled as such.
6. The in-memory rate limiter is per-edge-instance; a distributed limiter
   (e.g. Upstash) is the production upgrade path.

## Cross-device validation

This sandbox cannot drive Chrome/Firefox/Safari/Edge or mobile hardware.
The repo ships the QA matrix as a checklist (below) to run before launch:
Chrome · Firefox · Safari · Edge · Android Chrome · iOS Safari · IPv4-only ·
IPv6 · slow link · fast link · high-latency link · failed server · cancel
mid-stage. The engine has no browser-specific APIs beyond `fetch` streams
(supported in all of the above) — Safari < 14.1 falls back gracefully
because a missing `response.body` simply ends that stream.
