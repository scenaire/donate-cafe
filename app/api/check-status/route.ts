import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabase, statusFromStripe } from "@/lib/supabase";
import { promoteToSuccess } from "@/lib/orders";
import { clientKeyFromForwarded } from "@/lib/ratelimit";

// How stale a PENDING row must be before we spend a Stripe call on it. The
// payer polls every 3s, so without this every open tab would hammer Stripe from
// the instant the QR appears — exactly the traffic moving state into a database
// was meant to eliminate. A webhook normally lands well inside this window.
const SELF_HEAL_AFTER_MS = 15_000;

// This route is public and unauthenticated: the DB read below is cheap, but the
// two branches that fall through to Stripe (self-healing a stale PENDING, and
// the unknown-id fallback) turn any pi_ id into a Stripe API call. Uncapped,
// a script polling arbitrary ids could amplify into Stripe request volume —
// the twin of the /api/create-payment-intent limiter, on the same Postgres
// try_consume_rate primitive. A real payer only reaches Stripe here after 15s
// and polls their own order every 3s (~20 probes/min), so the ceiling sits well
// above legitimate use; over it we skip Stripe and return our own record rather
// than 429, so a paying customer is never blocked — the webhook and sweep still
// heal them.
const STRIPE_PROBE_MAX = 40;
const STRIPE_PROBE_WINDOW_SECONDS = 60;

async function mayProbeStripe(req: NextRequest): Promise<boolean> {
  const ip = clientKeyFromForwarded(req.headers.get("x-forwarded-for"), "unknown");
  const { data, error } = await supabase.rpc("try_consume_rate", {
    p_key: `cs:${ip}`,
    p_max: STRIPE_PROBE_MAX,
    p_window_seconds: STRIPE_PROBE_WINDOW_SECONDS,
  });
  // Fail OPEN, like create-payment-intent: a limiter blip must not strand a
  // payer whose webhook was missed. A check we couldn't run just lets the
  // probe through and logs.
  if (error) {
    console.error("check-status rate-limit check failed", error.message);
    return true;
  }
  return data !== false;
}

// Tier 2 of reconciliation (see the README).
//
// The DB owns status, so the happy path is a single indexed read. But if the
// webhook never arrives, a payer who has genuinely paid would sit watching a QR
// until the 10-minute timeout told them it expired. So when our record still says
// PENDING and the order is old enough to be suspicious, we ask Stripe directly
// and promote on the spot. Their own polling heals their own order, seconds
// after the failure, with no cron involved.
//
// This is not optional: on Vercel Hobby the scheduled sweep only runs daily, and
// the widget-driven sweep only runs while /alert is open. This route is the only
// thing standing between a missed webhook and a false "expired" screen.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !id.startsWith("pi_")) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("status, created_at")
    .eq("payment_intent_id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to read order status", error.message);
    return NextResponse.json({ error: "Could not check status." }, { status: 500 });
  }

  // No row: either a pre-cutover intent or a create that failed to record.
  // Fall back to Stripe so the payer still gets a correct answer — but gate it
  // on the probe limiter, since a bogus id lands here too.
  if (!data) {
    if (!(await mayProbeStripe(req))) {
      return NextResponse.json({ status: "PENDING" });
    }
    return stripeFallback(id);
  }

  if (data.status !== "PENDING") {
    return NextResponse.json({ status: data.status });
  }

  const ageMs = Date.now() - new Date(data.created_at).getTime();
  if (ageMs < SELF_HEAL_AFTER_MS) {
    return NextResponse.json({ status: "PENDING" });
  }

  // Old enough to be worth a Stripe check — but cap how often one IP can make us
  // make one. Over the ceiling we just return our own record; the payer keeps
  // polling and the webhook/sweep still heals them.
  if (!(await mayProbeStripe(req))) {
    return NextResponse.json({ status: "PENDING" });
  }

  // If Stripe says it landed, promote — which also publishes the on-stream
  // alert, so a missed webhook costs latency only.
  try {
    const intent = await stripe.paymentIntents.retrieve(id);
    if (statusFromStripe(intent.status) === "SUCCESS") {
      await promoteToSuccess(id);
      return NextResponse.json({ status: "SUCCESS", healed: true });
    }
  } catch (err) {
    console.error("Self-heal lookup failed", id, err);
    // Fall through: our record is still the best answer we have.
  }

  return NextResponse.json({ status: "PENDING" });
}

async function stripeFallback(id: string) {
  try {
    const intent = await stripe.paymentIntents.retrieve(id);
    return NextResponse.json({ status: statusFromStripe(intent.status) });
  } catch (err) {
    // An id neither we nor Stripe recognise (a bogus/garbage id, or a malformed
    // one) is not a server error — we simply have no record of this order. Answer
    // PENDING, matching the throttled and not-yet-old fallbacks above; the payer's
    // own 10-minute countdown ends the flow. A real pre-cutover intent WOULD be
    // found here, so this only affects ids that never existed. A genuine Stripe
    // outage (any other error type) still surfaces as 500 so the client retries.
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return NextResponse.json({ status: "PENDING" });
    }
    console.error("Failed to retrieve PaymentIntent", err);
    return NextResponse.json({ error: "Could not check status." }, { status: 500 });
  }
}
