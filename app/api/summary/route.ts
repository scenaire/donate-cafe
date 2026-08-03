import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isCurrency, type Currency } from "@/lib/money";

// Tip goal + running totals.
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
// Token-gated with ALERT_WIDGET_TOKEN so a goal bar can be its own OBS Browser
// Source without a login.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.ALERT_WIDGET_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("id, label, target_minor, currency, starts_at")
    .eq("is_active", true)
    .maybeSingle();

  if (goalError) {
    console.error("Failed to load goal", goalError.message);
    return NextResponse.json({ error: "Could not fetch summary." }, { status: 500 });
  }

  // Everything since the goal started, or the last 24h when no goal is set.
  const since = goal?.starts_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Aggregated in Postgres via SUM/GROUP BY rather than paging every SUCCESS
  // row since the goal started and reducing in JS — see supabase/schema.sql's
  // sum_succeeded_orders_since for why (this is the endpoint whose own header
  // above warns against exactly that O(n) shape).
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

  const raised = goal ? totals[goal.currency as Currency]?.amountMinor ?? 0 : 0;

  return NextResponse.json({
    since,
    totals,
    goal: goal
      ? {
          label: goal.label,
          currency: goal.currency,
          targetMinor: goal.target_minor,
          raisedMinor: raised,
          // Clamped so an overfunded goal doesn't render a bar past 100%.
          progress: Math.min(1, goal.target_minor > 0 ? raised / goal.target_minor : 0),
        }
      : null,
  });
}
