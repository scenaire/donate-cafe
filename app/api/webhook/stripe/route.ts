import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { promoteToSuccess, markReversed } from "@/lib/orders";
import type Stripe from "stripe";

export const runtime = "nodejs"; // Stripe's signature check needs Node crypto, not the Edge runtime

// SRS 1.3. This route used to verify the signature and then do nothing — the
// alert widget polled Stripe directly. Now it is the primary path that moves an
// order to SUCCESS and fires the on-stream alert.
//
// It is NOT the only path, on purpose: /api/sweep reconciles against Stripe and
// /api/check-status self-heals the payer's own order, so a missed delivery
// degrades to higher latency rather than a lost alert. See the reconciliation
// tiers in the README.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: import("stripe").Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error(
      "Webhook signature verification failed",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Step 2 — a succeeded payment moves an order to SUCCESS; a refund or
  // chargeback stamps it reversed (for the tip-goal bridge only — see
  // markReversed). Everything else is acknowledged so Stripe stops retrying it.
  const HANDLED = new Set(["payment_intent.succeeded", "charge.refunded", "charge.dispute.created"]);
  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  // Step 3 — idempotency. Stripe retries deliveries for up to 3 days, and an
  // unguarded retry would re-announce a tip that already played on stream.
  // The insert doubles as the lock: a duplicate event collides on the primary
  // key, so only the first delivery gets past this point.
  const { error: seenError } = await supabase
    .from("processed_stripe_events")
    .insert({ stripe_event_id: event.id });

  if (seenError) {
    // 23505 = unique_violation: we have already handled this exact event.
    if (seenError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Anything else means we could not establish idempotency. Fail loudly so
    // Stripe retries rather than risk processing this event twice later.
    console.error("Idempotency check failed", seenError.message);
    return NextResponse.json({ error: "Storage unavailable." }, { status: 500 });
  }

  // A refund/chargeback carries a Charge or Dispute, not a PaymentIntent — both
  // reference their payment_intent, which is how we find the order. Reversal is
  // read only by the tip-goal bridge (goal-credits); it does not walk `status`
  // back or touch this site's own totals.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
    const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
    if (pi) {
      const reversed = await markReversed(pi);
      if (!reversed.transitioned && reversed.reason === "not_found") {
        console.warn("Webhook reversal for unknown order", pi);
      }
    } else {
      console.warn("Webhook reversal with no payment_intent", event.id);
    }
    return NextResponse.json({ received: true });
  }

  // Steps 4 & 5 — match the order and transition it. promoteToSuccess handles
  // PENDING→SUCCESS and EXPIRED→SUCCESS atomically and publishes the alert;
  // SUCCESS is a no-op and FAILED is left alone for a human to override.
  const paymentIntentId = (event.data.object as Stripe.PaymentIntent).id;
  const result = await promoteToSuccess(paymentIntentId);

  if (!result.transitioned && result.reason === "not_found") {
    // An intent Stripe knows about but we have no row for — most likely one
    // created before the Supabase cutover and never backfilled. Worth seeing in
    // the logs, but not worth a retry: retrying will not create the row.
    console.warn("Webhook for unknown order", paymentIntentId);
  }

  return NextResponse.json({ received: true });
}
