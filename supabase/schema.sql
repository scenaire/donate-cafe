-- donate-minimal — Supabase schema
--
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
--
-- Design notes that matter:
--
--  * The DB owns order STATUS. Stripe still owns whether money moved; the
--    webhook and the sweep reconcile the two.
--  * Amounts are stored in the currency's SMALLEST unit, mirroring Stripe's own
--    `amount` field. This is deliberately NOT the v2 SRS's amount_thb +
--    amount_satang pair, which is THB-only and wrong for JPY — a zero-decimal
--    currency where ¥500 is 500, not 50000. Convert only via lib/money.ts.
--  * RLS is enabled on every table with NO policies at all. That is not an
--    oversight: the anon key is public by design, and every read and write in
--    this app goes through a server route holding the service-role key (which
--    bypasses RLS). No policy means no anon access, which is exactly right.

-- ── orders ────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  payment_intent_id text        not null unique,
  customer_name     text        not null,
  message           text,
  amount_minor      integer     not null check (amount_minor > 0),
  currency          text        not null check (currency in ('thb','usd','eur','jpy')),
  show_on_screen    boolean     not null default true,
  status            text        not null check (status in ('PENDING','SUCCESS','EXPIRED','FAILED')),
  -- NULL = never announced on stream. This replaces the old in-memory seenIds
  -- Set in the alert widget, which lost its contents on every OBS reload and
  -- caused recent tips to re-announce. Server-side state can't be reloaded away.
  alert_played_at   timestamptz,
  -- THB-equivalent snapshot, frozen at PENDING creation (see lib/fx.ts) so the
  -- supporters podium can rank across currencies without re-converting old
  -- tips at whatever rate happens to be cached today. All three NULL until
  -- captured; NULL means "unknown", never "zero" — see top_supporters_since.
  thb_equivalent_minor bigint,
  fx_rate_to_thb       numeric(18,8),
  fx_source            text check (fx_source is null or fx_source in ('identity','cache','seed','repair')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Columns above only apply to a fresh install (CREATE TABLE IF NOT EXISTS is a
-- no-op against the already-running production table) — these make the same
-- shape land on an existing database.
alter table public.orders add column if not exists thb_equivalent_minor bigint;
alter table public.orders add column if not exists fx_rate_to_thb       numeric(18,8);
alter table public.orders add column if not exists fx_source            text;
alter table public.orders drop constraint if exists orders_fx_source_check;
alter table public.orders add constraint orders_fx_source_check
  check (fx_source is null or fx_source in ('identity','cache','seed','repair'));

-- The reconciliation query: "succeeded, visible, not yet announced".
create index if not exists orders_pending_alerts_idx
  on public.orders (status, alert_played_at)
  where show_on_screen;

-- The sweep's other query: PENDING/EXPIRED rows to re-check against Stripe.
create index if not exists orders_status_created_idx
  on public.orders (status, created_at);

-- The dashboard's keyset pagination.
create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

-- The sweep's FX repair pass: rows still missing a THB snapshot. Self-emptying
-- once the repair catches up, so this stays tiny in steady state.
create index if not exists orders_fx_missing_idx
  on public.orders (created_at)
  where thb_equivalent_minor is null;

-- ── processed_stripe_events ───────────────────────────────────────────────
-- Stripe retries webhook deliveries for up to 3 days. Without this, a retry
-- would re-fire the on-stream alert for a tip that already played.
-- The daily cron sweep purges rows older than 7 days (see app/api/sweep).
create table if not exists public.processed_stripe_events (
  stripe_event_id text primary key,
  processed_at    timestamptz not null default now()
);

-- ── goals ─────────────────────────────────────────────────────────────────
-- Single-currency by design. Summing a goal across currencies would need an FX
-- rate table this app has no business owning, so a goal counts only tips in its
-- own currency; /api/summary reports the other currencies separately.
create table if not exists public.goals (
  id             uuid primary key default gen_random_uuid(),
  label          text        not null,
  target_minor   integer     not null check (target_minor > 0),
  currency       text        not null check (currency in ('thb','usd','eur','jpy')),
  -- Only tips created at or after this instant count toward the goal, so a goal
  -- can be "today" or "this stream" without deleting history.
  starts_at      timestamptz not null default now(),
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now()
);

-- At most one active goal — the overlay has room for exactly one.
create unique index if not exists goals_single_active_idx
  on public.goals (is_active)
  where is_active;

-- ── sweep_state ───────────────────────────────────────────────────────────
-- Backs the sweep throttle. One row, ever.
create table if not exists public.sweep_state (
  id           boolean primary key default true check (id),
  last_run_at  timestamptz not null default 'epoch'
);
insert into public.sweep_state (id) values (true) on conflict (id) do nothing;

-- Atomically claim the right to run a sweep. Returns true at most once per
-- `min_interval_seconds` no matter how many serverless instances call it at
-- once — the UPDATE ... WHERE is the lock. Doing this check in application code
-- would race, and the callers include an OBS browser source that may be
-- duplicated across scenes.
create or replace function public.try_acquire_sweep(min_interval_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.sweep_state
     set last_run_at = now()
   where id = true
     and last_run_at < now() - make_interval(secs => min_interval_seconds)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

-- Powers /api/summary. Pushes the SUM/GROUP BY into Postgres instead of
-- paging every SUCCESS row since the goal started and reducing in JS — the
-- exact O(n) shape that endpoint's own header warns against. sum(integer) is
-- cast to bigint so a very long-lived goal can never overflow the aggregate.
-- The existing orders_status_created_idx on (status, created_at) already
-- covers this filter, so no new index is needed.
create or replace function public.sum_succeeded_orders_since(since_ts timestamptz)
returns table (currency text, amount_minor bigint, cnt bigint)
language sql
stable
set search_path = public
as $$
  select currency, sum(amount_minor)::bigint, count(*)::bigint
  from public.orders
  where status = 'SUCCESS' and created_at >= since_ts
  group by currency;
$$;

-- ── rate_limits ───────────────────────────────────────────────────────────
-- Backs the per-IP throttle on /api/create-payment-intent (a public endpoint
-- that hits Stripe and writes an orders row on every call). One row per key,
-- fixed-window counter. The daily cron sweep purges stale rows (see
-- app/api/sweep and lib/orders.ts's purgeStaleRateLimits).
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

-- Atomically consume one request against the fixed window for `p_key`,
-- resetting the window if it has lapsed. Same reasoning as try_acquire_sweep
-- above: doing this check in application code would let two serverless
-- instances both decide they were under the limit. In ON CONFLICT DO UPDATE,
-- `rate_limits.col` refers to the pre-update row, so both CASE branches read
-- the same old window_start: past the window resets to count = 1, otherwise
-- increments. RETURNING reads the post-update count.
create or replace function public.try_consume_rate(
  p_key text, p_max integer, p_window_seconds integer
) returns boolean
language plpgsql
set search_path = public
as $$
declare allowed boolean;
begin
  insert into public.rate_limits (key, window_start, count)
       values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when public.rate_limits.window_start
                          < now() - make_interval(secs => p_window_seconds)
                        then now() else public.rate_limits.window_start end,
    count        = case when public.rate_limits.window_start
                          < now() - make_interval(secs => p_window_seconds)
                        then 1 else public.rate_limits.count + 1 end
  returning (public.rate_limits.count <= p_max) into allowed;
  return allowed;
end;
$$;

-- ── fx_rates ──────────────────────────────────────────────────────────────
-- Last-known THB conversion rate per non-THB currency, used only to RANK
-- supporters across currencies (never displayed — see lib/fx.ts). THB itself
-- is implicit at 1 and never stored here. fetched_on is a plain date (Bangkok
-- calendar day) so "is this still today's rate" is a cheap equality check.
create table if not exists public.fx_rates (
  currency     text primary key check (currency in ('usd','eur','jpy')),
  thb_per_unit numeric     not null,
  fetched_on   date        not null,
  updated_at   timestamptz not null default now()
);

-- ── fx_refresh_state ──────────────────────────────────────────────────────
-- Backs try_acquire_fx_refresh's throttle. One row, ever — same shape as
-- sweep_state, kept separate because it guards a different external call
-- (Frankfurter, not Stripe) with its own cadence.
create table if not exists public.fx_refresh_state (
  id           boolean primary key default true check (id),
  last_run_at  timestamptz not null default 'epoch'
);
insert into public.fx_refresh_state (id) values (true) on conflict (id) do nothing;

-- Atomically claim the right to refresh FX rates. Same reasoning as
-- try_acquire_sweep: the UPDATE ... WHERE is the lock, so of however many
-- concurrent serverless instances notice the cached rate is stale, exactly one
-- fetches Frankfurter and the rest fall back to the last-known rate.
create or replace function public.try_acquire_fx_refresh(min_interval_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.fx_refresh_state
     set last_run_at = now()
   where id = true
     and last_run_at < now() - make_interval(secs => min_interval_seconds)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

-- Powers /api/supporters' podium. Groups by lower(trim(customer_name)) so
-- "Nam" and "nam " rank as one supporter, excluding blank/anonymous names and
-- hidden tips at the source rather than filtering them out in app code.
-- display_name = min(...) picks a stable representative casing for display.
-- Ranks on thb_equivalent_minor, which every order already carries as of
-- write time (see lib/fx.ts) — no FX folding in app code, no re-converting an
-- old tip at whatever rate happens to be cached today. Rows with no snapshot
-- yet are excluded rather than counted as zero (NULL means "unknown", not
-- "nothing"). limit_n and the ranking/tie-break both happen here so the route
-- does no sorting of its own. Covered by the existing orders_status_created_idx
-- on (status, created_at).
--
-- Returns ONE column on purpose. The name is the only thing /api/supporters is
-- allowed to publish, and that endpoint is unauthenticated — so the THB total
-- that decides the ranking is computed, sorted and discarded entirely inside
-- Postgres, and never crosses into app code where a later careless
-- `...row` spread could leak it. The grouping key and tip count were likewise
-- dropped: nothing consumed them. Order is significant — the route derives
-- rank from row position, so ORDER BY here is the contract.
--
-- Postgres can't change a function's return type via CREATE OR REPLACE, so
-- every prior signature must be dropped explicitly to keep this file
-- re-runnable: (timestamptz) was the read-time-FX design, and
-- (timestamptz, integer) returned name_key/thb_minor/tip_count alongside the
-- name.
drop function if exists public.top_supporters_since(timestamptz);
drop function if exists public.top_supporters_since(timestamptz, integer);

create or replace function public.top_supporters_since(since_ts timestamptz, limit_n integer default 3)
returns table (display_name text)
language sql
stable
set search_path = public
as $$
  select min(customer_name) as display_name
  from public.orders
  where status = 'SUCCESS'
    and show_on_screen
    and trim(customer_name) <> ''
    and lower(trim(customer_name)) <> 'anonymous'
    and created_at >= since_ts
    and thb_equivalent_minor is not null
  group by lower(trim(customer_name))
  -- Aggregates, not output columns: the ranking figure stays internal.
  order by sum(thb_equivalent_minor) desc, min(customer_name) asc
  limit limit_n;
$$;

-- One-time backfill: the 36 pre-existing THB orders in production have no
-- snapshot yet. THB's rate is trivially 1, so this needs no FX lookup at all.
-- Guarded by the IS NULL check, safe to re-run.
update public.orders
   set thb_equivalent_minor = amount_minor,
       fx_rate_to_thb       = 1,
       fx_source            = 'identity'
 where currency = 'thb'
   and thb_equivalent_minor is null;

-- ── updated_at maintenance ────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────
-- Enabled with no policies: anon and authenticated get nothing. Server routes
-- use the service-role key, which bypasses RLS entirely.
alter table public.orders                  enable row level security;
alter table public.processed_stripe_events enable row level security;
alter table public.goals                   enable row level security;
alter table public.sweep_state             enable row level security;
alter table public.rate_limits             enable row level security;
alter table public.fx_rates                enable row level security;
alter table public.fx_refresh_state        enable row level security;

-- Realtime is NOT enabled on these tables on purpose. postgres_changes enforces
-- RLS, so exposing alerts that way would mean granting anon read access to the
-- very columns (name, message, amount) the alert token exists to protect.
-- Alerts are delivered by server-side Broadcast on a channel whose name embeds
-- ALERT_WIDGET_TOKEN instead — see lib/realtime.ts.
