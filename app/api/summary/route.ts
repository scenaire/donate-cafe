import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isCurrency, type Currency } from "@/lib/money";
import { isValidWidgetToken } from "@/lib/widget-token";
import { computeGoalSummary } from "@/lib/goal";
import { DEFAULT_JAR_CONFIG, type JarConfig } from "@/lib/cafe";

// Tip goal + running totals + the goal-bar overlay's own style/code config.
//
// This is the endpoint that most justified the database. Computing it against
// Stripe meant paginating every succeeded PaymentIntent on each overlay
// refresh — O(n) network calls that got slower with every tip received, and
// rate-limit exposure during exactly the moments you are busiest.
//
// Currency note: a goal counts only tips in its OWN currency. Converting a ¥ tip
// into a ฿ goal needs an FX rate, and an app with no rate source that invents
// one is worse than an app that doesn't try. Other currencies are reported
// separately under `totals` so nothing is hidden, just not conflated.
//
// Token-gated with the widget token so a goal bar can be its own OBS Browser
// Source without a login. This was already built with that in mind before the
// goal-bar overlay panel existed — it's the goal-bar's data endpoint now,
// jarConfig included, rather than a separate near-duplicate route.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!(await isValidWidgetToken(token))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [summary, jarRes] = await Promise.all([
    computeGoalSummary(),
    supabase.from("cafe_settings").select("jar_config").eq("id", true).maybeSingle(),
  ]);
  const jarConfig: JarConfig = { ...DEFAULT_JAR_CONFIG, ...(jarRes.data?.jar_config as Partial<JarConfig> | undefined) };

  // Everything since the goal started, or the last 24h when no goal is set.
  // computeGoalSummary() doesn't expose starts_at (callers don't need the raw
  // timestamp), so this endpoint's own `totals` breakdown re-derives its window
  // the same way — a fresh RPC call, not reusing the goal's raised figure,
  // since totals cover every currency, not just the goal's own.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Aggregated in Postgres via SUM/GROUP BY rather than paging every SUCCESS
  // row and reducing in JS — see supabase/schema.sql's sum_succeeded_orders_since
  // for why (this is the endpoint whose own header above warns against exactly
  // that O(n) shape).
  const { data, error } = await supabase.rpc("sum_succeeded_orders_since", { since_ts: since });

  if (error) {
    console.error("Failed to sum orders", error.message);
    return NextResponse.json({ error: "Could not fetch summary." }, { status: 500 });
  }

  const totals: Partial<Record<Currency, { amountMinor: number; count: number }>> = {};
  for (const row of (data ?? []) as { currency: string; amount_minor: number; cnt: number }[]) {
    if (!isCurrency(row.currency)) continue;
    totals[row.currency] = { amountMinor: Number(row.amount_minor), count: Number(row.cnt) };
  }

  return NextResponse.json({
    since,
    totals,
    jarConfig,
    goal: summary
      ? {
          label: summary.label,
          currency: summary.currency,
          targetMinor: summary.targetMinor,
          raisedMinor: summary.raisedMinor,
          progress: summary.progress,
          showOnOverlay: summary.showOnOverlay,
        }
      : null,
  });
}
