# Add Recent Supporters + Top Supporters panel (public tip page)

## Context

The tip page (`app/page.tsx`) is currently a single centered 440px card. We want a
Buy-Me-a-Coffee–style **supporters panel** on the right of that card, containing (top
to bottom): an all-time **supporter count**, a **Top-3 podium** with a timeframe
switcher, and a **Recent supporters** list. It is public-facing — every visitor sees
it — which is a deliberate new posture for this app.

This is a meaningful architectural step: **the app currently has no public
(unauthenticated) read endpoint**, and RLS blocks the anon key entirely. We are
building the first internet-readable route. The plan therefore treats data exposure,
caching, and the cross-currency ranking problem as first-class concerns, not
afterthoughts.

The drink/dessert **photo** feature is explicitly out of scope for now — avatars use an
initials-on-colored-circle fallback that will later swap for the photo.

## Resolved design decisions (from grilling)

| Topic | Decision |
|---|---|
| Surface | Public tip page `/`, visible to all visitors |
| Eligibility | Only tips with `status='SUCCESS'` **and** `show_on_screen=true` |
| Amounts | **Shown** per row on the Recent list; **hidden** on the podium |
| Top ranking metric | Total amount across **all currencies**, normalized to THB via real FX |
| FX capture | **Snapshotted per-order at PENDING creation** (not at read time) — see "FX snapshot amendment" below |
| FX refresh | Rates cache refreshed from `/api/sweep` (throttled); the checkout path only ever reads the cache, never fetches |
| FX source | `api.frankfurter.dev` (free, no key), ECB market reference rate. Last-known cached in a table; hardcoded **seed** fallback; checkout never blocks on or calls the fetch |
| Grouping | Group by `lower(trim(customer_name))`; **exclude anonymous/blank names** from the podium |
| Timeframe | Calendar periods, **Bangkok time** (week=since Mon 00:00, month=since 1st, year=since Jan 1; 90d=rolling; all-time=none). Default **90 days**. Controls the podium only — Recent is always latest |
| Panel content | Count header + podium (with switcher) + Recent list |
| "N Supporters" count | All-time count of eligible tips (timeframe-independent) |
| Recent list | Latest **5**; fetch on page load + refetch when the visitor's own tip succeeds; no polling |
| Recent row | Avatar + `{name} tipped {amount}`; **no message text** |
| Avatar | Initials on a colored circle (deterministic color from name); anonymous → 🌸 |
| Row phrasing | `{name} tipped ฿100` (TH: `{name} ให้ทิป ฿100`) |
| Layout | Two-column on desktop (~900px, top-aligned), stack below the card under ~820px |
| Public API protection | Minimal fields only + short cache (~30–60s, `s-maxage` + in-memory) |

## FX snapshot amendment (post-grilling, supersedes the original FX design below)

The original design converted currencies **at read time, for ranking only** — every
historical order, regardless of when it was created, would be ranked using whatever
rate is cached *today*. The user wants the DB to record the actual THB-equivalent at
the moment of the tip, so the stored figure reflects real THB received at that time,
not a rate looked up after the fact and retroactively applied. That moves FX from a
read-time ranking concern into the **order write path**. Resolved specifics:

| Topic | Decision |
|---|---|
| Capture point | At **PENDING creation** (`/api/create-payment-intent`), not at SUCCESS promotion. The amount is already frozen at creation; capturing the rate at the same instant keeps both numbers describing the same moment. Critically, this means `lib/orders.ts`'s promotion logic — reachable from 4 different code paths (webhook, check-status, sweep, admin override) — needs **zero changes**, avoiding a multi-writer race on the snapshot. |
| Rate source | **ECB market rate** (Frankfurter), not Stripe's settlement rate. Simpler, no extra Stripe call at settlement, doesn't touch the safety-critical promotion path. Accepted tradeoff: a few % off Stripe's actual net-of-fee conversion — this panel is a ranking podium, not accounting. |
| Refresh path | The checkout path (`/api/create-payment-intent`) **only ever reads** the `fx_rates` cache — it never calls Frankfurter and can never be slowed or blocked by it. `/api/sweep` is the sole caller of the fetch, since it's already throttled, already polled every ~30s while live, and can afford to `await` (unlike a payer-facing request). |
| Live-fetch on checkout | **Rejected.** No opportunistic race against Frankfurter on the card path — the checkout path must have zero dependency on an external FX API. A rate up to ~24h stale (worst case: streamer offline for days, only the daily cron sweep runs) is acceptable for ranking. |
| THB orders | Still get a snapshot, trivially (`rate=1`, `thb_equivalent_minor=amount_minor`). Keeps NULL meaning exactly one thing ("unknown"), and means the dominant PromptPay flow does **zero** FX work. |
| Bad-rate protection | A NEW risk write-time snapshots introduce: under the old read-time design a bad rate self-corrected on the next refresh; here it's frozen into rows forever. A plausibility band per currency rejects an implausible fetched rate before it's ever written to `fx_rates`. |
| Missing/seed snapshots | Repaired by `/api/sweep`, not by `lib/orders.ts`. Covers rows with `thb_equivalent_minor IS NULL` (capture failed) and recent `fx_source='seed'` rows (repair once a real rate is available). |
| Backfill | Checked production (`Naire-tipped` Supabase project): **zero non-THB orders exist today**, so no historical-rate backfill script is needed right now. A one-line SQL `update` backfills the existing 36 THB rows with the identity snapshot. If non-THB orders accumulate later, a small one-off script using Frankfurter's time-series endpoint would be the way to backfill them — not needed yet. |
| Ranking of unsnapshotted rows | **Excluded**, never coerced to 0 — NULL means "unknown," and counting it as zero would silently demote a real supporter. |

## Implementation

### 1. Database (`supabase/schema.sql`)

- **`orders` gains three nullable columns**: `thb_equivalent_minor bigint`,
  `fx_rate_to_thb numeric(18,8)`, `fx_source text` (check-constrained to
  `identity|cache|seed|repair`). Nullable because pre-existing rows have no snapshot.
  Plus a partial index `orders_fx_missing_idx on orders(created_at) where
  thb_equivalent_minor is null` for the sweep's repair query (self-emptying once caught up).
- **`fx_rates` table** — one row per non-THB currency:
  `currency text pk` (check-constrained to `usd|eur|jpy` — THB is never stored here, its
  rate is implicit 1), `thb_per_unit numeric not null`, `fetched_on date not null`,
  `updated_at timestamptz`. RLS enabled, no policies (like every other table).
- **`try_acquire_fx_refresh(min_interval_seconds int) returns boolean`** — copy of
  `try_acquire_sweep`'s single-row throttle so concurrent serverless instances don't
  all hit Frankfurter at once. Backed by a one-row `fx_refresh_state` table.
- **`top_supporters_since(since_ts timestamptz, limit_n integer default 3)`** —
  `stable sql`, returns **`(display_name text)` and nothing else**, grouped by
  `lower(trim(customer_name))` where `status='SUCCESS' and show_on_screen and
  trim(customer_name) <> '' and lower(trim(customer_name)) <> 'anonymous' and
  created_at >= since_ts and thb_equivalent_minor is not null`. Ranking, the
  tie-break and the top-N cut all happen in SQL
  (`order by sum(thb_equivalent_minor) desc, min(customer_name) asc`) — **no FX
  folding in app code**. The THB total is an ORDER BY aggregate, not an output
  column, so the ranking figure is computed and discarded *inside Postgres* and
  never crosses into app code at all; `/api/supporters` is unauthenticated, and this
  removes the possibility of a later careless row-spread leaking it. Row order is
  the contract — the route derives `rank` from position. Since a function's return
  type can't change via `create or replace`, `schema.sql` drops both prior
  signatures first to stay re-runnable.
- **THB identity backfill**: `update orders set thb_equivalent_minor = amount_minor,
  fx_rate_to_thb = 1, fx_source = 'identity' where currency='thb' and
  thb_equivalent_minor is null` — guarded by the `is null`, safe to re-run.
- The **count** and **recent** queries need no new RPC — plain PostgREST (see route below).

`schema.sql` is re-runnable (`if not exists` / `or replace`); these additions follow suit.

### 2. FX module (`lib/fx.ts`, new)

Two halves that never mix: a **pure read half** used on the payment path, and a
**fetching half** used only by the sweep. Nothing on a payer-facing request may ever
`await` a network call to Frankfurter.

- `SEED_THB_PER_UNIT: Record<Currency, number>` — editable seed constant
  (`thb:1, usd:36, eur:39, jpy:0.24`). Last-resort only; rows using it are tagged
  `fx_source='seed'` and re-snapshotted later by the sweep's repair pass.
- `PLAUSIBLE_THB_PER_UNIT` — per-currency sanity bands (e.g. `usd:[20,60]`,
  `eur:[22,70]`, `jpy:[0.10,0.60]`). A fetched rate outside its band is discarded and
  logged rather than written to `fx_rates` — the guard that stops one Frankfurter
  glitch poisoning permanently-stored order rows.
- `getCachedRatesToThb()` — **pure, no `fetch`.** Module-level in-memory cache (~60s) →
  `fx_rates` table (3 rows) → `SEED_THB_PER_UNIT`. Returns which tier answered so the
  caller can record `fx_source`. Cannot hang, cannot fail.
- `snapshotThb(amountMinor, currency)` → `{ thbEquivalentMinor, fxRateToThb, fxSource }`
  — the write-path helper called from `/api/create-payment-intent`. Short-circuits
  `currency === 'thb'` to `{ amountMinor, 1, 'identity' }` with **no lookup at all**.
  Otherwise `Math.round(fromMinorUnits(amountMinor, currency) * rate * 100)` (THB is
  two-decimal; via `lib/money.ts`, never a bare ×100).
- `refreshRatesIfStale()` — the **only** code that touches Frankfurter. Checks
  `fx_rates.fetched_on` against today's Bangkok date, calls `try_acquire_fx_refresh(...)`;
  the winner fetches `https://api.frankfurter.dev/v1/latest?base=THB&symbols=USD,EUR,JPY`
  with a short `AbortSignal.timeout`, inverts to THB-per-unit, validates against the
  plausibility bands, and upserts `fx_rates`. Never throws. **Called from `/api/sweep`
  only** — a fire-and-forget refresh from a request handler is unreliable on Vercel,
  since the lambda can freeze once the response is sent.
- `repairMissingSnapshots(limit)` — used by the sweep. Re-snapshots `SUCCESS` rows with
  a NULL `thb_equivalent_minor`, and recent `fx_source='seed'` rows (bounded lookback so
  it doesn't endlessly rewrite ancient rows), tagging the result `fx_source='repair'`.

### 3. Public API route (`app/api/supporters/route.ts`, new)

- **Unauthenticated GET.** Accepts `?timeframe=week|month|90d|year|all` (default `90d`).
- Computes the Bangkok-time `since_ts` cutoff in JS (calendar boundaries; UTC+7, no DST).
- Runs in parallel: `top_supporters_since(since_ts, 3)` RPC (already summed + ranked in
  SQL — no app-side FX folding), a recent query
  (`.eq('status','SUCCESS').eq('show_on_screen',true).order('created_at',desc).limit(5)`
  selecting **only** `customer_name, amount_minor, currency, created_at`), and an
  all-time eligible **count** (`select('*', { count:'exact', head:true })` with the same
  two filters).
- Maps the RPC rows straight to `{ displayName, rank }`. Returns **minimal** JSON:
  `{ count, timeframe, top: [{ displayName, rank }], recent: [{ name, amountMinor,
  currency, createdAt }] }`. **Never** returns `payment_intent_id`, `message`, `status`,
  or any THB-normalized amount — the RPC does not hand one to app code in the first
  place, so this is enforced by the function's shape rather than by remembering not to
  serialize a field.
- Sets `Cache-Control: public, s-maxage=45, stale-while-revalidate=60` and keeps a small
  module-level in-memory cache keyed by timeframe to absorb bursts on a warm instance.
- Uses the service-role `supabase` client server-side (as every route does) — the anon
  key never touches this data.
- `/api/sweep` gains one addition: after its existing reconcile loop, call
  `refreshRatesIfStale()` then `repairMissingSnapshots(25)` (mirrors `RECONCILE_BATCH`),
  both no-throw.

### 4. Frontend

- **`components/SupportersPanel.tsx`** (new, `"use client"`): receives `lang`. Fetches
  `/api/supporters?timeframe=…` on mount and on timeframe change; exposes a `refresh()`
  the page calls when a tip succeeds. Renders count header, podium (3 avatars, #1 center
  larger with rank badges; renders 1–2 gracefully; empty message when the period has
  none), timeframe switcher (segmented control / select), and the recent list. Amounts
  via `formatMoney(amountMinor, currency)`.
- **`components/SupporterAvatar.tsx`** (new): initials from the display name; background
  color chosen deterministically from a name hash over the sakura/matcha palette in
  `lib/theme.ts`; anonymous/blank → 🌸. Built so a future `photoUrl` prop supersedes the
  fallback.
- **`app/page.tsx`**: wrap the existing `.page` column and `<SupportersPanel/>` in a new
  `.stage` flex row (near the top of the returned JSX, around line 624). Call the panel's
  `refresh()` when `screen === "success"`. Keep `ThemeToggle`/`lang-toggle`/`petals` where
  they are.
- **`app/globals.css`**: add a `.stage` two-column layout (`display:flex;
  align-items:flex-start; justify-content:center; gap; max-width:~900px`) plus the app's
  **first** width media query — below ~820px, `.stage` becomes a column so the panel
  stacks under the tip card. New classes for the panel/podium/avatar/recent-row use the
  existing `var(--…)` tokens (follow the dashboard's self-contained styling convention).
- **`lib/i18n.ts`**: add to the payer-facing `translations` type + `th`/`en` objects:
  `supportersRecentTitle`, `supportersTopTitle`, `supportersCount(n)`,
  `tippedPhrase(name, money)`, `anonymousLabel`, the five timeframe labels, and
  empty-state strings.

## Known limitations (call out to user, not blockers)

- Name-based grouping collapses different people who type the same name and splits one
  person who varies spelling — inherent to free-text names with no identity.
- Each order stores the THB equivalent at the moment it was created, using the most
  recent ECB daily rate available at that time (refreshed by the sweep — up to ~24h old
  if the stream has been offline). It's a **market reference rate, not Stripe's
  settlement rate**, so it won't match a payout to the satang — accepted tradeoff,
  confirmed with the user, since this panel ranks, it doesn't do accounting.
- Orders with no snapshot (rare capture failure not yet repaired by the sweep) are
  **excluded** from podium totals rather than counted as zero. A supporter with a mix of
  snapshotted and unsnapshotted tips ranks on an undercounted total until the repair
  pass catches up.
- Frankfurter uses ECB reference rates; THB is supported. If it's ever unavailable at
  capture time, the order still gets a snapshot via the last-known cached rate, then the
  hardcoded seed — capture never fails outright, and seed-sourced snapshots are repaired
  once a real rate is available.

## Verification

1. `npm run typecheck` (the real gate) and `npm run lint`.
2. Seed a few `SUCCESS` orders across currencies (incl. one JPY and one anonymous/blank
   name; one with `show_on_screen=false`) via Supabase SQL, with a snapshot filled in.
3. `npm run dev`, open `/` in the preview:
   - Panel renders right of the card on desktop; stacks below under ~820px
     (`resize_window`).
   - `show_on_screen=false` tip is absent from both lists; anonymous tip appears in
     Recent as 🌸 "Anonymous tipped …" but **not** on the podium.
   - Recent shows amounts in each row's own currency; podium shows no amounts.
   - Switch timeframes → podium updates, count stays fixed.
   - Verify JPY is ranked sensibly (¥ tip not treated as 1:1 with ฿) — confirms FX
     normalization, not raw `amount_minor`.
4. `curl /api/supporters` → confirm response contains **no** `payment_intent_id`,
   `message`, or normalized THB amounts, and carries the `Cache-Control` header.
5. Complete a test tip end-to-end (any currency) → inspect the resulting `orders` row:
   `thb_equivalent_minor`/`fx_rate_to_thb`/`fx_source` are populated (THB →
   `fx_source='identity'`, `rate=1`); confirm checkout latency is unaffected and no
   Frankfurter call was made from the create-payment-intent path. Then confirm the
   Recent list refetches and shows the new tip.
6. Run `schema.sql` twice against a DB that already has the old `top_supporters_since` →
   confirm the `drop function if exists` lines make the second run succeed.
7. Hit `/api/sweep` → confirm `fx_rates` refreshes when stale and any `fx_source='seed'`
   row from step 5 is repaired to `fx_source='repair'`.