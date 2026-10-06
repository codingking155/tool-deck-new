# ToolDeck V3 — design system

ToolDeck is a *utility operating system*: Home is **Discovery mode** (expressive, tactile,
memorable); every tool page is **Work mode** (quiet, dense, precise). The journey is
DISCOVER → SELECT → FOCUS.

All global styles live in `src/styles.css` (tokens → base → motion → shell → primitives →
home → tool shell → footer). Tool-specific styles live in `src/tools/css/<tool>.css` and are
imported by the tool, so they ship in that tool's lazy chunk.

## Tokens (never hard-code colours in components)

| Role | Token | Legacy alias still valid |
|---|---|---|
| Page background | `--bg` | |
| Secondary background / wells | `--bg-secondary` | `--bg2` |
| Surface (panels, cards) | `--surface` | `--panel` |
| Elevated surface (popovers, active segment) | `--surface-elevated` | `--panel2` |
| Interactive surface (hover / selected rows) | `--surface-interactive` | |
| Input background | `--input-bg` | |
| Border / subtle border | `--border` / `--border-subtle` | `--line` / `--line2` |
| Form-control border (≥3:1) | `--border-strong` | `--line-strong` |
| Text 1/2/3 | `--text-primary/secondary/tertiary` | `--tx/--tx2/--tx3` |
| Brand fill / brand text | `--brand` / `--brand-text` | `--pri` / `--pri2` |
| Semantic | `--success --warning --danger --info` | `--good --warn --bad --teal` |
| Focus / scrim | `--focus` / `--scrim` | |
| Current tool hue | `--tool-accent` (set by ToolShell) | |

Tints: `color-mix(in srgb, var(--good) 12%, transparent)` — never rgba of a raw hex.
Light-mode accent text values are contrast-checked (≥4.5:1 on surfaces and their 12% tints).
Tool hues (`tool.c`) are decorative in light mode; for text use
`color-mix(in srgb, var(--cc) 70%, #000)`.

Scales: spacing `--s1..--s10` = 4 8 12 16 20 24 32 40 48 64 · radius `--r-xs 6 / --r-sm 8 /
--r 10 / --r-lg 14 / --r-xl 18` · controls `--ctl 44px`, `--ctl-sm 36px` · type `--fs-2xs..--fs-3xl` ·
motion `--dur-1 120ms` (feedback) `--dur-2 200ms` (controls) `--dur-3 300ms` (panels), `--ease`,
`--ease-spring`. Fonts: `--disp` Space Grotesk (brand, headings, hero metrics), `--body` Inter
(UI), `--mono` IBM Plex Mono (URLs, code, timestamps, technical values, eyebrow labels).

## Primitives (class → use)

- **Buttons** `.btn` secondary · `.btn.pri` primary (full width by default; `.auto` to size to
  content) — one per region · `.btn.gh` tertiary · `.btn.qt` quiet text · `.btn.danger` ·
  `.btn.ico` icon-only (needs `aria-label`) · `.btn.sm`. Labels describe outcomes
  ("Check domain", "Download PDF"), never "Submit".
- **Fields** `.field > label + input|select|textarea` · `.hint` helper · `.err-tx` error ·
  `aria-invalid` + `aria-describedby` for errors · `.inrow` input + button on one line
  (`.stack` to stack on phones) · `.two/.three` grids.
- **Choice** `.seg`/`.modes` segmented control (buttons with `aria-pressed` or `aria-selected`) ·
  `.pill` filter chips · `.tgl` toggle row + `<Switch>`.
- **Status** `<StatusBadge tone="ok|warn|bad|info|brand">` (always text, optional icon) ·
  `<PrivacyBadge where>` · `<BetaBadge>`.
- **Notices** `<Notice tone="i|w|e|ok|off" title actions>` — calm left rail, icon, never a red
  wall. Legacy `.note.i/.w/.e/.ok` still works.
- **Results** `.bigres > .lab + .val + .sub` (headline) · `.metrics > <Metric>` (hairline grid
  of numbers) · `.kv > .k + .v` rows · `details.more > summary` progressive disclosure for
  technical detail · `.tblwrap > table.rt`.
- **States** `<EmptyState icon title actions>` · `.skel` skeleton · `.prog > i` determinate
  progress / `.prog.ind` indeterminate · `describeError(err)` → `{ title, hint, kind }` for
  offline / rate-limit / network / server errors.
- **Feedback** `<CopyButton text label done>` (Copy → ✓ Copied, 1.6 s) · `notify(msg)` toast.
- **Layout** `.panel > .ph + .pb` only for real groups (no card-in-card) · `.grid2`
  (380px controls + flexible result; add `.sticky` to the result column) · `.sect` /
  `.secbar` section headers · `.actions` button row.

## Tool archetypes

- **A · Input → Result** (Phone, Shopify, SSL, Breach): input row → primary action → inline
  loading → strong verdict (icon + words, not colour alone) → key facts → `details.more`
  technical evidence.
- **B · Live configuration** (UTC, Password, Prompt): parameters left, sticky live result
  right; warnings inline; share/export as secondary actions.
- **C · Data workspace** (JSON): toolbar of modes → editor/output → status line
  (valid · lines · chars · size).
- **D · File workspace** (Image, PDF, YouTube): drop zone → selected assets (ordered,
  removable) → operation → settings for that operation only → progress → export.
- **E · Measurement** (Speed, IP, Price): current state → start/refresh → staged progress →
  headline metrics → diagnostics → history.

## Rules

- Tool pages are calmer than Home: no decorative animation in a workspace; motion only for
  state change, progress and feedback.
- Never wait on an animation; prefer `transform`/`opacity`; respect `prefers-reduced-motion`.
- Every interactive element: visible `:focus-visible`, ≥44px touch target on phones, a label.
- Privacy is a feature: say where data goes in calm language next to the action that sends it.
- Price Tracker shows real data only (see CLAUDE.md).
- Define components at module scope; keep per-second state in leaf components.
