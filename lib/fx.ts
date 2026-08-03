// THB conversion for the supporters podium's cross-currency ranking.
//
// Every order snapshots its own THB-equivalent at PENDING creation time (see
// snapshotThb, called from /api/create-payment-intent) rather than being
// converted at read time with whatever rate happens to be cached today — see
// docs/plans/supporters-panel.md's "FX snapshot amendment" for why. That
// split matters for how this file is organised:
//
//   - getCachedRatesToThb() / snapshotThb() are the READ half: pure, no
//     `fetch`, safe to call from a payer-facing request. They read the
//     `fx_rates` table (or its 60s in-memory cache) and fall back to a seed
//     constant. They can never hang and never throw — snapshotThb is TOTAL,
//     and that is load-bearing, not a nicety. It is awaited alongside the
//     Stripe call in /api/create-payment-intent, where the PromptPay branch
//     confirms the intent server-side. A rejection there would 500 the request
//     *after* money could already move, and `recordOrder` would never run — so
//     the tip would exist at Stripe with no row here at all, invisible to every
//     reconciliation tier (they all scan rows that already exist). Degrade to
//     the seed rate instead; a slightly-off ranking figure is nothing next to
//     a lost order.
//   - refreshRatesIfStale() is the WRITE half: the only code in this app that
//     calls Frankfurter. It is throttled via try_acquire_fx_refresh and is
//     called from /api/sweep only — never from the checkout path, and never
//     fire-and-forget from a request handler (a floating promise after the
//     response is sent is not guaranteed to run on Vercel).
//
// A rate written to `fx_rates` is stored permanently on every order snapshotted
// against it, so — unlike the old read-time design, where a bad rate
// self-corrected on the next refresh — a bad fetched rate here would be frozen
// into the ledger forever. PLAUSIBLE_THB_PER_UNIT exists to reject one before
// it's ever written.

import { supabase } from "./supabase";
import { fromMinorUnits, toMinorUnits, type Currency } from "./money";

type ForeignCurrency = Exclude<Currency, "thb">;
const FOREIGN_CURRENCIES: ForeignCurrency[] = ["usd", "eur", "jpy"];

// Last-resort fallback when `fx_rates` has no row yet (fresh install) or a
// read fails. Update by hand occasionally — rows using this are tagged
// `fx_source: "seed"` and re-snapshotted once a real rate is available (see
// repairMissingSnapshots).
export const SEED_THB_PER_UNIT: Record<Currency, number> = {
  thb: 1,
  usd: 36,
  eur: 39,
  jpy: 0.24,
};

// Sanity bands a freshly-fetched rate must fall inside before it's written to
// `fx_rates`. Guards against a Frankfurter glitch (or a parsing bug) getting
// permanently baked into stored order rows.
const PLAUSIBLE_THB_PER_UNIT: Record<ForeignCurrency, [number, number]> = {
  usd: [20, 60],
  eur: [22, 70],
  jpy: [0.1, 0.6],
};

type RateInfo = { rate: number; source: "cache" | "seed" };

const CACHE_TTL_MS = 60_000;
let cache: { data: Record<ForeignCurrency, RateInfo>; expiresAt: number } | null = null;

function seedRates(): Record<ForeignCurrency, RateInfo> {
  return Object.fromEntries(
    FOREIGN_CURRENCIES.map((c) => [c, { rate: SEED_THB_PER_UNIT[c], source: "seed" as const }])
  ) as Record<ForeignCurrency, RateInfo>;
}

// Pure read: `fx_rates` (a 3-row table) behind a short in-memory cache, falling
// back to the seed constant. No `fetch`, cannot hang, cannot throw — safe to
// call from the checkout path.
export async function getCachedRatesToThb(): Promise<Record<ForeignCurrency, RateInfo>> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  try {
    const { data, error } = await supabase.from("fx_rates").select("currency, thb_per_unit");
    if (error) {
      console.error("Failed to read fx_rates, falling back to seed", error.message);
      // Deliberately not cached: the next call retries against the DB rather
      // than pinning every order to the seed rate for a full TTL window.
      return seedRates();
    }

    const byCurrency = new Map(
      (data ?? []).map((r: { currency: string; thb_per_unit: number }) => [r.currency, r.thb_per_unit])
    );
    const result = Object.fromEntries(
      FOREIGN_CURRENCIES.map((c) => {
        const stored = byCurrency.get(c);
        return stored != null ? [c, { rate: stored, source: "cache" as const }] : [c, { rate: SEED_THB_PER_UNIT[c], source: "seed" as const }];
      })
    ) as Record<ForeignCurrency, RateInfo>;

    cache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch (err) {
    // Not merely defensive: lib/supabase.ts's client is a lazy Proxy that
    // THROWS on first property access when the env vars are missing, and a
    // transport-level failure can reject rather than come back as `error`.
    // Without this the "cannot throw" promise above would be a comment, not a
    // guarantee — and the caller is a payment path.
    console.error("fx_rates read threw, falling back to seed", err);
    return seedRates();
  }
}

export type FxSnapshot = { thbEquivalentMinor: number; fxRateToThb: number; fxSource: "identity" | "cache" | "seed" };

function snapshotAtRate(amountMinor: number, currency: Currency, rate: number, source: FxSnapshot["fxSource"]): FxSnapshot {
  const thbMajor = fromMinorUnits(amountMinor, currency) * rate;
  return { thbEquivalentMinor: toMinorUnits(thbMajor, "thb"), fxRateToThb: rate, fxSource: source };
}

// The write-path helper: what /api/create-payment-intent calls to freeze a
// THB-equivalent onto a new order. THB short-circuits with no lookup at all —
// the dominant PromptPay flow never touches fx_rates.
//
// TOTAL BY CONTRACT: this never rejects. See the file header — it is awaited
// next to a Stripe call that may already have confirmed a payment, so throwing
// here would cost a whole order row rather than just an accurate rate.
export async function snapshotThb(amountMinor: number, currency: Currency): Promise<FxSnapshot> {
  if (currency === "thb") {
    return { thbEquivalentMinor: amountMinor, fxRateToThb: 1, fxSource: "identity" };
  }
  try {
    const { rate, source } = (await getCachedRatesToThb())[currency];
    return snapshotAtRate(amountMinor, currency, rate, source);
  } catch (err) {
    console.error("FX snapshot fell back to seed", currency, err);
    return snapshotAtRate(amountMinor, currency, SEED_THB_PER_UNIT[currency], "seed");
  }
}

// Bangkok has no DST, so a fixed +7h offset always lands on the correct
// calendar day — matches `fx_rates.fetched_on`, which is a plain date.
function bangkokDateString(d = new Date()): string {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchLiveRates(): Promise<Partial<Record<ForeignCurrency, number>>> {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=THB&symbols=USD,EUR,JPY", {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);

  const body = (await res.json()) as { rates?: Record<string, number> };
  const out: Partial<Record<ForeignCurrency, number>> = {};
  for (const [code, perThb] of Object.entries(body.rates ?? {})) {
    const currency = code.toLowerCase() as ForeignCurrency;
    if (!(currency in PLAUSIBLE_THB_PER_UNIT) || !Number.isFinite(perThb) || perThb <= 0) continue;

    // Frankfurter with base=THB returns "1 THB = perThb <code>"; invert for
    // "THB per 1 <code>", the shape this app stores and multiplies by.
    const thbPerUnit = 1 / perThb;
    const [min, max] = PLAUSIBLE_THB_PER_UNIT[currency];
    if (thbPerUnit < min || thbPerUnit > max) {
      console.error(`FX rate for ${currency} outside plausible band (${thbPerUnit}), discarding`);
      continue;
    }
    out[currency] = thbPerUnit;
  }
  return out;
}

// Bounds retry frequency when the cache is stale but Frankfurter is down —
// not a real rate-limit concern, since Frankfurter publishes once per day.
const MIN_REFRESH_INTERVAL_SECONDS = 20 * 60;

// The only function in this app that calls Frankfurter. Called from
// /api/sweep, never from the checkout path. Never throws.
export async function refreshRatesIfStale(): Promise<void> {
  try {
    const today = bangkokDateString();
    const { data: rows, error } = await supabase.from("fx_rates").select("currency, fetched_on");
    if (error) {
      console.error("Failed to check fx_rates staleness", error.message);
      return;
    }

    const byCurrency = new Map((rows ?? []).map((r: { currency: string; fetched_on: string }) => [r.currency, r.fetched_on]));
    const stale = FOREIGN_CURRENCIES.some((c) => byCurrency.get(c) !== today);
    if (!stale) return;

    // Atomic claim: concurrent callers race here and exactly one wins — same
    // pattern as try_acquire_sweep. The rest simply keep using the cache.
    const { data: claimed, error: claimError } = await supabase.rpc("try_acquire_fx_refresh", {
      min_interval_seconds: MIN_REFRESH_INTERVAL_SECONDS,
    });
    if (claimError) {
      console.error("FX refresh throttle check failed", claimError.message);
      return;
    }
    if (!claimed) return;

    const live = await fetchLiveRates();
    const upserts = Object.entries(live).map(([currency, thbPerUnit]) => ({
      currency,
      thb_per_unit: thbPerUnit,
      fetched_on: today,
      updated_at: new Date().toISOString(),
    }));
    if (upserts.length === 0) return;

    const { error: upsertError } = await supabase.from("fx_rates").upsert(upserts, { onConflict: "currency" });
    if (upsertError) {
      console.error("Failed to upsert fx_rates", upsertError.message);
      return;
    }

    cache = null; // force the next read to pick up the fresh rates
  } catch (err) {
    console.error("FX refresh failed", err);
  }
}

type FxRepairRow = { id: string; amount_minor: number; currency: Currency; fx_source: string | null };

// Sweep-only repair pass: fills orders with no snapshot yet (a rare capture
// failure) and re-snapshots recent seed-sourced rows once a real rate is
// available. Bounded lookback so it doesn't endlessly rewrite ancient rows
// that are stuck on the seed fallback for good.
const SEED_REPAIR_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export async function repairMissingSnapshots(limit: number): Promise<{ repaired: number }> {
  const seedCutoff = new Date(Date.now() - SEED_REPAIR_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("id, amount_minor, currency, fx_source")
    .eq("status", "SUCCESS")
    .or(`thb_equivalent_minor.is.null,and(fx_source.eq.seed,created_at.gt.${seedCutoff})`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("FX repair query failed", error.message);
    return { repaired: 0 };
  }

  let repaired = 0;
  for (const row of (data ?? []) as FxRepairRow[]) {
    const snapshot = await snapshotThb(row.amount_minor, row.currency);

    // Don't repeatedly rewrite a row that's still stuck on the seed
    // fallback — only touch it once a real rate is available, or it had no
    // snapshot at all yet.
    if (row.fx_source === "seed" && snapshot.fxSource === "seed") continue;

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        thb_equivalent_minor: snapshot.thbEquivalentMinor,
        fx_rate_to_thb: snapshot.fxRateToThb,
        fx_source: row.fx_source === "seed" ? "repair" : snapshot.fxSource,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error("FX repair update failed", row.id, updateError.message);
      continue;
    }
    repaired++;
  }

  return { repaired };
}
