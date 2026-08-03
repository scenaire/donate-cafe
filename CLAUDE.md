# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development server at http://localhost:3000
npm run build        # Production build
npm start            # Serve production build
npm run typecheck    # tsc --noEmit  ← the real gate; use this
npm run lint         # eslint . — flat config (eslint.config.mjs) extending
                     # next/core-web-vitals + next/typescript via FlatCompat.
                     # Runs non-interactively. Not the primary gate — npm run
                     # typecheck is.
npm run backfill -- --dry-run   # One-time Stripe → orders migration

# Local Stripe webhook testing (requires Stripe CLI)
stripe listen --forward-to localhost:3000/api/webhook/stripe
```

Environment: copy `.env.example` to `.env.local`. See that file for what each
variable is and which ones are secret.

## Architecture

Next.js 14 + Supabase Postgres. **The database owns order status; Stripe owns
whether money moved.** The webhook and a reconciliation sweep keep the two
agreeing.

### Pages

- **`/` ([app/page.tsx](app/page.tsx))** — Tip form. Submits to `/api/create-payment-intent`, then polls `/api/check-status` every 3s while showing a PromptPay QR with a 10-minute countdown. Card payments use the Stripe Payment Element in the deferred flow (intent created only at Pay time).
- **`/alert` ([app/alert/page.tsx](app/alert/page.tsx))** — OBS Browser Source. Subscribes to a Supabase Realtime Broadcast channel for instant alerts, reconciles every 30s against `/api/recent-alerts`, and acks each played alert. Gated by `ALERT_WIDGET_TOKEN`. URL-tunable: `holdMs`, `sound=0`, `minAmount`, `ttsMin` (bare number = THB, or `thb:100,usd:3`), `test=1`.
- **`/dashboard` ([app/dashboard/page.tsx](app/dashboard/page.tsx))** — Admin table with server-side search and status filter, plus the manual-override button. Requires a Supabase Auth session matching `ADMIN_EMAIL`.
- **`/login` ([app/login/page.tsx](app/login/page.tsx))** — Email + password sign-in. No signup and no reset flow by design; the one account is created by hand in Supabase. `requireAdmin()` still gates on `ADMIN_EMAIL`, so a session alone is not authorisation.

### API Routes (`app/api/`)

| Route | Purpose |
|---|---|
| `POST /api/create-payment-intent` | Creates a Stripe PaymentIntent and records the order as PENDING. PromptPay → confirmed server-side, returns a QR URL; card → returns a `client_secret`. Honours a client-supplied `idempotencyKey`. |
| `GET /api/check-status` | Reads status from the DB. **Also tier 2 reconciliation** — falls through to Stripe when the row is PENDING and older than 15s, and promotes it. |
| `GET /api/recent-alerts` | Token-gated. Succeeded, visible tips with `alert_played_at IS NULL`. |
| `POST /api/alerts/ack` | Token-gated. Stamps `alert_played_at`. This is what stops alerts replaying across OBS reloads. |
| `GET\|POST /api/sweep` | Token-gated (widget) or `Bearer $CRON_SECRET` (cron). Expires stale PENDINGs and reconciles against Stripe. Server-side throttled via the `try_acquire_sweep` RPC. |
| `GET /api/summary` | Token-gated. Goal progress and per-currency totals. |
| `GET /api/transactions` | Session-gated. Order list with keyset pagination, search, status filter. |
| `POST /api/admin/override` | Session-gated. Forces SUCCESS and replays the alert. |
| `GET /api/tts` | Google Translate TTS proxy. `lang` allowlisted to `th`/`en` — it is interpolated into the outbound URL. Token-gated (`ALERT_WIDGET_TOKEN`). |
| `POST /api/webhook/stripe` | Signature check → idempotency → state transition → alert. |

### Shared Libraries (`lib/`)

- **[lib/supabase.ts](lib/supabase.ts)** — **SERVER ONLY.** Service-role client, lazy behind a Proxy so `next build` doesn't need production secrets. Bypasses RLS. Never import from a `"use client"` file.
- **[lib/supabase-browser.ts](lib/supabase-browser.ts)** — Anon-key browser client. Safe to ship.
- **[lib/supabase-server.ts](lib/supabase-server.ts)** — Cookie-scoped client + `requireAdmin()`.
- **[lib/realtime.ts](lib/realtime.ts)** — **SERVER ONLY.** `publishAlert()`. Read its header before changing alert delivery.
- **[lib/realtime.shared.ts](lib/realtime.shared.ts)** — Channel contract shared with the browser. Deliberately free of server imports so the widget can never pull in the service-role client.
- **[lib/orders.ts](lib/orders.ts)** — All state transitions. Conditional `UPDATE … RETURNING` so racing callers can't double-announce.
- **[lib/money.ts](lib/money.ts)** — Currency behaviour and every minor↔major conversion. **Never hardcode × 100** — JPY is zero-decimal.
- **[lib/validate.ts](lib/validate.ts)** — Input chokepoint: HTML stripping, profanity masking, length clamps, per-currency amount ranges.
- **[lib/profanity.ts](lib/profanity.ts)** — Masks rather than rejects. Header explains why, and which terms are excluded as substring false positives.
- **[lib/theme.ts](lib/theme.ts)** — Palette. Generates both the CSS custom properties and the Stripe `appearance` objects. Edit colours here, not in `globals.css`.
- **[lib/i18n.ts](lib/i18n.ts)** — `translations` (payer) and `dashboardTranslations` (admin).
- **[lib/brand.ts](lib/brand.ts)** — `BRAND_NAME` / `STREAMER_NAME`.

### Key Design Constraints

- **Currency**: THB, USD, EUR, JPY. Stored in the smallest unit, mirroring Stripe's own `amount`. THB/USD/EUR are × 100; **JPY is zero-decimal** (¥500 → `500`). Always convert via `lib/money.ts`.
- **Payment methods**: PromptPay (THB only, server-confirmed QR) and card (all currencies, deferred Payment Element). Non-THB is forced to card.
- **RLS is enabled with no policies at all.** That is intentional, not an oversight: the anon key is public, and every read/write goes through a server route holding the service-role key. Adding an anon policy would undermine the alert channel's security model — read [lib/realtime.ts](lib/realtime.ts) first.
- **Alerts use Broadcast, not `postgres_changes`.** `postgres_changes` enforces RLS, so table-based Realtime would require granting anon read access to the exact columns the widget token protects. The channel name embeds `ALERT_WIDGET_TOKEN` instead.
- **Reconciliation has four tiers** because Vercel Hobby crons only fire daily:
  1. Stripe webhook — instant, normal path.
  2. `/api/check-status` — self-heals the payer's own order within seconds.
  3. `/alert`'s 30s poll calls `/api/sweep` — table-wide, while you're live.
  4. Daily Vercel Cron — the floor, and the keepalive that stops the Supabase free tier pausing at 7 days idle.
- **`show_on_screen`**: set per order; hidden tips never reach the overlay (enforced in `publishAlert` *and* in the alerts query).
