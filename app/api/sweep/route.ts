import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabase, statusFromStripe, type OrderRow } from "@/lib/supabase";
import {
  expireStalePending,
  markFailed,
  promoteToSuccess,
  purgeProcessedEvents,
  purgeStaleRateLimits,
} from "@/lib/orders";
import { refreshRatesIfStale, repairMissingSnapshots } from "@/lib/fx";
import { isValidWidgetToken } from "@/lib/widget-token";

export const runtime = "nodejs";

// TTL: a PromptPay QR lives 10 minutes, matching TIMEOUT_MS on the tip page.
const EXPIRE_AFTER_MS = 10 * 60 * 1000;
// Don't re-check the whole history — only orders recent enough that a late
// confirmation is still plausible.
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECONCILE_BATCH = 25;
// Minimum gap between real sweeps. Enforced in Postgres, not here.
const THROTTLE_SECONDS = 20;
// Retention for the webhook idempotency ledger. Stripe retries deliveries for
// ~3 days, so 7 days is a safe margin before a row is dead weight.
const PROCESSED_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Retention for the rate-limit counters. A fixed window is at most
// RATE_WINDOW_SECONDS long, so a day is a generous margin before a row is
// dead weight — one row per active IP, swept daily.
const RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;
// Batch size for the FX repair pass, mirroring RECONCILE_BATCH.
const FX_REPAIR_BATCH = 25;

// Reconciliation sweep. Two jobs: expire stale PENDINGs, and ask Stripe the
// truth about anything our records still consider unresolved.
//
// Called by two very different callers, which is why the throttle is
// server-side:
//
//   1. The /alert widget, every ~30s while you are live (widget token).
//      That is an OBS Browser Source — it can be duplicated across scenes,
//      reloaded repeatedly, or left running in several windows. It cannot be
//      trusted to pace itself, and each sweep costs real Stripe API calls.
//   2. The daily Vercel Cron (CRON_SECRET). Vercel Hobby only allows daily
//      crons, so this is the floor, not the primary driver. It also doubles as
//      the keepalive that stops the Supabase free tier pausing after 7 days.
// Vercel Cron invokes cron paths with GET; the widget uses POST. Same handler.
export async function GET(req: NextRequest) {
  return runSweep(req);
}

export async function POST(req: NextRequest) {
  return runSweep(req);
}

async function runSweep(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const auth = req.headers.get("authorization");

  const widgetOk = await isValidWidgetToken(token);
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const cronOk = Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!widgetOk && !cronOk) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Atomic claim: concurrent callers race here and exactly one wins. Doing this
  // check in JS would let two instances both decide they were first.
  const { data: claimed, error: claimError } = await supabase.rpc("try_acquire_sweep", {
    min_interval_seconds: THROTTLE_SECONDS,
  });
  if (claimError) {
    console.error("Sweep throttle check failed", claimError.message);
    return NextResponse.json({ error: "Sweep unavailable." }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ skipped: "throttled" });
  }

  const expired = await expireStalePending(EXPIRE_AFTER_MS);

  // Anything we still think is unresolved, recent enough to be worth a lookup.
  // EXPIRED is included deliberately: a payer who paid after their QR timed out
  // still gets their alert (SRS 1.3), which is what makes the expired screen's
  // "let Naire know in chat — it'll still go through" promise true.
  const since = new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString();
  const { data: candidates, error } = await supabase
    .from("orders")
    .select("payment_intent_id")
    .in("status", ["PENDING", "EXPIRED"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECONCILE_BATCH);

  if (error) {
    console.error("Sweep candidate query failed", error.message);
    return NextResponse.json({ expired, reconciled: 0, failed: 0, error: "partial" });
  }

  let reconciled = 0;
  let failed = 0;
  for (const row of (candidates ?? []) as Pick<OrderRow, "payment_intent_id">[]) {
    try {
      const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
      const mapped = statusFromStripe(intent.status);
      if (mapped === "SUCCESS") {
        // promoteToSuccess publishes the alert, so a tip recovered here still
        // lands on stream exactly as a webhook-delivered one would.
        const result = await promoteToSuccess(row.payment_intent_id);
        if (result.transitioned) reconciled++;
      } else if (mapped === "FAILED") {
        const result = await markFailed(row.payment_intent_id);
        if (result.transitioned) failed++;
      }
      // else PENDING: still in flight, nothing to do.
    } catch (err) {
      console.error("Sweep lookup failed", row.payment_intent_id, err);
    }
  }

  // Purge the idempotency ledger and stale rate-limit counters on the cron
  // path only — daily is the right cadence for both retention windows, and it
  // keeps the hot widget-driven sweep free of DELETEs that would almost
  // always match zero rows.
  let purged = 0;
  let rateLimitsPurged = 0;
  if (cronOk) {
    purged = await purgeProcessedEvents(PROCESSED_EVENT_TTL_MS);
    rateLimitsPurged = await purgeStaleRateLimits(RATE_LIMIT_TTL_MS);
  }

  // Refreshing fx_rates and repairing any order missing its THB snapshot runs
  // on every sweep call, not just cron — it's cheap (own throttle via
  // try_acquire_fx_refresh) and the more often it runs while live, the sooner
  // a rate outage repairs itself. Never throws.
  await refreshRatesIfStale();
  const { repaired } = await repairMissingSnapshots(FX_REPAIR_BATCH);

  return NextResponse.json({
    expired,
    reconciled,
    failed,
    purged,
    rateLimitsPurged,
    fxRepaired: repaired,
    checked: candidates?.length ?? 0,
  });
}
