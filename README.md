# donate-minimal

A tip page for a Thai streamer: PromptPay + card via Stripe → OBS alert widget
with TTS → admin dashboard. Four currencies. Supabase Postgres owns order
status; Stripe owns whether the money moved.

## How it works

```
payer submits ──► PaymentIntent created ──► orders row written as PENDING
                                                      │
                        ┌─────────────────────────────┤
                        ▼                             ▼
              Stripe webhook fires            webhook is missed
                        │                             │
                        ▼                             ▼
              status → SUCCESS            one of three fallbacks catches it
                        │                             │
                        └──────────► Realtime Broadcast ──► /alert plays it
                                                          └► ack sets alert_played_at
```

**Reconciliation has four tiers.** Vercel's Hobby plan only allows a daily
cron, so instead of leaning on a scheduler the work is driven by whoever is
already polling:

| Tier | Trigger | Covers |
|---|---|---|
| 1 | Stripe webhook | The normal path, instantly |
| 2 | `/api/check-status`, polled every 3s while a QR is up | The payer's own order — heals within seconds |
| 3 | `/alert`'s 30s poll calls `/api/sweep` | The whole table, while you're live |
| 4 | Daily Vercel Cron | Stragglers, plus it keeps Supabase from pausing at 7 days idle |

The gap this accepts: a webhook missed while nothing at all is open waits for
the daily cron. That only means an alert didn't play while you weren't
streaming.

**The ToS-compliance footer is load-bearing.** "This is a purchase for a
digital roleplay service… not a charitable donation" keeps the Stripe account
in good standing for an individual in Thailand. Reword it if you like, but
don't drop the "digital service, not a donation" framing.

---

## 0. Supabase setup

1. Create a project at [supabase.com](https://supabase.com). Note the region —
   pick one near Thailand (Singapore) so Realtime latency stays low.
2. **SQL Editor → New query**, paste all of
   [supabase/schema.sql](supabase/schema.sql), run it. Safe to re-run.
3. **Settings → API**: copy the project URL, the `anon` key, and the
   `service_role` key into `.env.local` (see `.env.example`).
4. **Authentication → Users → Add user** → *Create new user*. Set your admin
   email and a strong password, and tick **Auto Confirm User**. Put the same
   address in `ADMIN_EMAIL`.

   This is the only account that will ever exist — `/login` is email +
   password, there is no signup form, and no password-reset flow. If you lock
   yourself out, set a new password from this same page.

   No SMTP configuration and no redirect-URL allowlist are needed; nothing in
   the sign-in path sends email.

### Migrating existing history

If you already have tips in Stripe, import them once:

```bash
npm run backfill -- --dry-run   # look first
npm run backfill                # then write
```

Every backfilled row gets `alert_played_at` set, so your back catalogue can
never announce itself on stream. The script is idempotent — safe to re-run if
it dies partway.

---

## 1. Stripe setup

1. In the [Stripe Dashboard](https://dashboard.stripe.com), make sure
   PromptPay is enabled (it should be automatic for Thailand accounts —
   confirm under **Settings → Payment methods**).
2. Copy your **secret key** from **Developers → API keys** into
   `STRIPE_SECRET_KEY`.
3. Complete your Stripe KYC if you haven't already — PromptPay payouts need
   a verified account.

## 2. Alert widget setup

The `/alert` page is your OBS Browser Source. It polls `/api/recent-alerts` for
tips that haven't played yet and plays a sakura-themed card with TTS. There is
no setup step — loading the URL is the whole thing. It starts polling and
subscribing the instant the token is read out of the query string, because
OBS's embedded Chromium allows autoplay without a user gesture.

1. Make up any long random string and set it as `ALERT_WIDGET_TOKEN` in
   Vercel's env vars, then redeploy. This is just a password so random
   people can't load your alert feed and see who tipped what.
2. In OBS, add a new **Browser Source** pointing at:
   `https://your-domain.com/alert?token=YOUR_TOKEN`
3. Set the source width/height to whatever fits your scene (e.g. 800×300),
   and leave "Shutdown source when not visible" unchecked so it keeps
   polling even when the source isn't on screen. This matters more than it
   used to: since there's no click to get back in after a reload, an
   unattended reload used to mean a silent widget until someone noticed.

> **Careful with a stray preview tab.** Because there's no click gating it,
> opening the alert URL in an ordinary browser tab to check it starts polling
> immediately — and acks each alert it plays. A tip that plays in a preview
> tab won't play again in OBS.

### Tuning the widget from the URL

No redeploy needed — append these to the Browser Source URL:

| Param | Effect |
|---|---|
| `holdMs=5000` | How long a card stays on screen (clamped 1000–60000, default 7000) |
| `sound=0` | Mute the chime (TTS is unaffected) |
| `minAmount=100` | Don't announce tips under this amount |
| `ttsMin=200` | Show the card but skip the spoken message under this amount |
| `test=1` | Reveal the test-alert buttons in a floating panel (top-left) |

`minAmount` and `ttsMin` take a bare number, which applies to **THB only** —
`$100` would silence nearly every card tip, so the shorthand doesn't spread
across currencies. For per-currency control use `minAmount=thb:100,usd:3,jpy:300`.

Voices come from Google Translate's TTS via `/api/tts`, so quality doesn't
depend on anything installed locally. Thai is detected per-tip from the name
and message. The endpoint is token-gated (`ALERT_WIDGET_TOKEN`), same as the
rest of the widget's API calls.

## 3. Dashboard

`/dashboard` lists every transaction — Timestamp, Customer Name, Amount (in the
tip's own currency), Message, Show-on-Screen, Status — with server-side search
and a status filter, plus a **Force success** button on any order that isn't
already succeeded.

Sign in at `/login` with the email and password you set in step 0.4. Only
`ADMIN_EMAIL` is accepted, enforced server-side on every request. There is no
token in the URL any more.

**About Force success:** it sets the order to SUCCESS *and* clears
`alert_played_at`, so the alert replays on stream exactly as a real payment
would — it publishes through the same `publishAlert` path the webhook uses. It
is the last-resort tool for something the four reconciliation tiers couldn't
fix. It will fire on stream, so it asks for confirmation first.

## 4. Tip goal (optional)

Insert a row in `goals`:

```sql
insert into goals (label, target_minor, currency)
values ('Coffee fund', 500000, 'thb');   -- ฿5,000 (minor units!)
```

`GET /api/summary?token=…` then returns progress plus per-currency totals. A
goal counts only tips in its **own** currency — converting a ¥ tip into a ฿ goal
would need an FX rate this app has no business inventing.

## 5. Deploy

```bash
npm install
vercel --prod
```

Then in **Settings → Environment Variables** add everything from
`.env.example`:

- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ALERT_WIDGET_TOKEN`, `ADMIN_EMAIL`, `CRON_SECRET`

`DASHBOARD_TOKEN` is retired — delete it.

Redeploy after adding them (`vercel --prod` again) so they take effect.
[vercel.json](vercel.json) registers the daily sweep cron automatically.

## 6. Stripe webhook

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://your-domain.com/api/webhook/stripe`
3. Listen to event: `payment_intent.succeeded`
4. Copy the **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`, then
   redeploy.

## 7. Test end-to-end

Use [test mode](https://docs.stripe.com/test-mode) keys first. A test PromptPay
QR can be confirmed from the Stripe Dashboard's payment detail page ("Confirm
test payment"), so you don't need a real Thai bank account.

- **Happy path** — QR shows → confirm the test payment → page flips to "Thank
  you" → `/alert` shows the card and reads it aloud → the row appears in
  `/dashboard` as Succeeded.
- **No replay** — with a succeeded tip a few minutes old, reload the OBS source.
  It must stay silent. This is the bug the whole database migration existed to
  fix; test it deliberately.
- **Missed webhook, both halves** — stop `stripe listen`, then confirm a
  payment. (a) With the payer's page open, it must still flip to Thank You
  within a few seconds (tier 2). (b) With the payer's page closed, `/alert`
  must still announce within ~30s (tier 3). These are separate code paths.
- **Idempotency** — `stripe events resend <id>` must not produce a second alert.
- **Expired → success** — create an intent, never pay, wait 10 minutes for
  EXPIRED, then confirm it late in Stripe. It must go SUCCESS *and* alert.
- **Auth** — signed out, `/dashboard` sends you to `/login`, and
  `/api/transactions` returns 401.
- **RLS closed** — with only the anon key, `select * from orders` must return
  nothing.

Switch to live keys when all of that passes.

---

## Local dev

```bash
cp .env.example .env.local   # fill in your keys
npm install
npm run dev
```

Note: Stripe webhooks won't reach `localhost` directly — use the
[Stripe CLI](https://docs.stripe.com/stripe-cli) (`stripe listen --forward-to
localhost:3000/api/webhook/stripe`) for local webhook testing.
