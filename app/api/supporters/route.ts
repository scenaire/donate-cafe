import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isCurrency } from "@/lib/money";
import { clientKeyFromForwarded } from "@/lib/ratelimit";

// The app's first unauthenticated, internet-readable route. Every other GET
// endpoint is either token-gated (the OBS widget) or session-gated (the
// dashboard) — this one is meant to be hit by anyone who loads the tip page,
// so the response is deliberately minimal: no payment_intent_id, no message,
// no status, no THB-normalized amount. See docs/plans/supporters-panel.md.

const TIMEFRAMES = ["week", "month", "90d", "year", "all"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
function isTimeframe(x: string | null): x is Timeframe {
  return TIMEFRAMES.includes(x as Timeframe);
}

const RECENT_LIMIT = 5;
const TOP_LIMIT = 3;
const CACHE_SECONDS = 45;
const STALE_SECONDS = 60;
// `max-age=0` is load-bearing, not noise. `s-maxage` applies only to SHARED
// caches, so without an explicit `max-age` the BROWSER falls back to heuristic
// freshness and can serve its own private copy for an unpredictable stretch —
// observed in practice as a reload still showing a tip that had already been
// removed. This keeps the CDN behaviour the plan asked for (s-maxage=45 + swr)
// while forcing the browser to revalidate, which is what makes a plain page
// load reliably current.
const CACHE_HEADERS = {
  "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
};
// `?fresh=1` responses must not be stored anywhere, or the cache-buster in the
// URL would just fill the CDN with single-use entries.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// The cache above is what makes this endpoint cheap, but it also means a payer
// who has just tipped would be served a copy of the list from before their own
// tip — the one moment the panel is guaranteed to be watched. `?fresh=1` skips
// both caches for that single request. It is throttled per IP because it is a
// public, unauthenticated bypass of the only thing protecting this endpoint.
const FRESH_RATE_MAX = 12; // bypasses per IP …
const FRESH_RATE_WINDOW_SECONDS = 60; // … per minute

// Small in-memory cache keyed by timeframe, to absorb a burst of requests on
// one warm instance between full HTTP-cache windows. Each serverless instance
// has its own module state, so this is a supplement to the Cache-Control
// header above, not a substitute for it.
const responseCache = new Map<Timeframe, { body: unknown; expiresAt: number }>();

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, no DST

// Reads `d`'s calendar fields as they'd appear on a Bangkok wall clock, by
// shifting the instant forward and reading UTC fields off the result.
function bangkokFields(d: Date) {
  const shifted = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(), // 0 = Sunday .. 6 = Saturday
  };
}

// The UTC instant corresponding to 00:00 Bangkok time on the given
// Bangkok-local calendar date. Date.UTC normalizes an out-of-range `date`
// (e.g. 0, or negative), so callers can subtract days freely.
function bangkokMidnightUtc(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month, date, 0, 0, 0) - BANGKOK_OFFSET_MS);
}

// Calendar-period cutoffs in Bangkok time — controls the podium only; the
// Recent list and the all-time count ignore this entirely.
function sinceForTimeframe(tf: Timeframe, now = new Date()): Date {
  switch (tf) {
    case "all":
      return new Date(0);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "year": {
      const { year } = bangkokFields(now);
      return bangkokMidnightUtc(year, 0, 1);
    }
    case "month": {
      const { year, month } = bangkokFields(now);
      return bangkokMidnightUtc(year, month, 1);
    }
    case "week": {
      const { year, month, date, day } = bangkokFields(now);
      const daysSinceMonday = (day + 6) % 7; // Mon=0 .. Sun=6
      return bangkokMidnightUtc(year, month, date - daysSinceMonday);
    }
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // Allowlisted before it is used as a cache key, so `responseCache` can never
  // hold more than the five known timeframes no matter what is in the query.
  const raw = params.get("timeframe");
  const timeframe: Timeframe = isTimeframe(raw) ? raw : "90d";

  let fresh = params.get("fresh") === "1";
  if (fresh) {
    const ip = clientKeyFromForwarded(req.headers.get("x-forwarded-for"), "unknown");
    const { data: allowed, error: rlError } = await supabase.rpc("try_consume_rate", {
      p_key: `sup:${ip}`,
      p_max: FRESH_RATE_MAX,
      p_window_seconds: FRESH_RATE_WINDOW_SECONDS,
    });
    // Fails CLOSED (degrades to the cached copy), the opposite of
    // /api/create-payment-intent's deliberate fail-open. Nothing is lost by
    // serving supporter data that is up to 45s stale; that endpoint fails open
    // because refusing it would block a paying customer.
    if (rlError) {
      console.error("Supporters fresh-path rate-limit check failed", rlError.message);
      fresh = false;
    } else if (allowed === false) {
      fresh = false;
    }
  }

  if (!fresh) {
    const cached = responseCache.get(timeframe);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.body, { headers: CACHE_HEADERS });
    }
  }

  const since = sinceForTimeframe(timeframe).toISOString();

  const [topResult, recentResult, countResult] = await Promise.all([
    // Already summed on the stored THB snapshot and ranked in SQL — see
    // top_supporters_since in supabase/schema.sql. No FX folding here.
    supabase.rpc("top_supporters_since", { since_ts: since, limit_n: TOP_LIMIT }),
    supabase
      .from("orders")
      .select("customer_name, amount_minor, currency, created_at")
      .eq("status", "SUCCESS")
      .eq("show_on_screen", true)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "SUCCESS")
      .eq("show_on_screen", true),
  ]);

  if (topResult.error || recentResult.error || countResult.error) {
    console.error(
      "Failed to load supporters",
      topResult.error?.message,
      recentResult.error?.message,
      countResult.error?.message
    );
    return NextResponse.json({ error: "Could not load supporters." }, { status: 500 });
  }

  const top = ((topResult.data ?? []) as { display_name: string }[]).map((row, i) => ({
    displayName: row.display_name,
    rank: i + 1,
  }));

  const recent = ((recentResult.data ?? []) as {
    customer_name: string;
    amount_minor: number;
    currency: string;
    created_at: string;
  }[])
    .filter((row) => isCurrency(row.currency))
    .map((row) => ({
      name: row.customer_name,
      amountMinor: row.amount_minor,
      currency: row.currency,
      createdAt: row.created_at,
    }));

  const body = {
    count: countResult.count ?? 0,
    timeframe,
    top,
    recent,
  };

  // A fresh read still populates the shared cache — the tip that triggered it
  // is news for every other visitor too, not just the payer.
  responseCache.set(timeframe, { body, expiresAt: Date.now() + CACHE_SECONDS * 1000 });

  return NextResponse.json(body, { headers: fresh ? NO_STORE_HEADERS : CACHE_HEADERS });
}
