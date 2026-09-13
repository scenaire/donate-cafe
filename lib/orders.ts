// Order state transitions. Every path that can move an order to SUCCESS goes
// through here: the Stripe webhook, the reconciliation sweep, and the admin
// manual override.
//
// The atomicity matters. Those three callers can and do race — a webhook
// arriving while the sweep is mid-flight is the normal case, not an edge case.
// Each transition is expressed as a conditional UPDATE ... RETURNING, so the
// database decides the winner: exactly one caller sees a returned row and
// therefore exactly one alert is published. Checking status with a SELECT and
// then writing would double-announce tips on stream.

import { supabase, type OrderRow, type OrderStatus } from "./supabase";
import { publishAlert, publishGoalUpdate } from "./realtime";
import { publishLiveUpdate } from "./live";
import { pushTipCredit } from "./bridge";

// Statuses a tip may be promoted from. SUCCESS is excluded so a replayed
// webhook is a no-op; FAILED is excluded because it needs a human decision
// (that is what the admin override is for).
const PROMOTABLE: OrderStatus[] = ["PENDING", "EXPIRED"];

export type PromoteResult =
  | { transitioned: true; order: OrderRow }
  | { transitioned: false; reason: "not_found" | "already_final" };

// PENDING → SUCCESS, and EXPIRED → SUCCESS.
//
// The EXPIRED case is deliberate and load-bearing (SRS 1.3): a PromptPay payer
// whose QR timed out but who actually paid still gets their moment on stream.
// That is what makes the expired screen's "let Naire know in chat — it'll still
// go through automatically" promise true.
export async function promoteToSuccess(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "SUCCESS" })
    .eq("payment_intent_id", paymentIntentId)
    .in("status", PROMOTABLE)
    .select()
    .maybeSingle();

  if (error) {
    console.error("promoteToSuccess failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }
  if (!data) {
    // Either the row is already SUCCESS/FAILED, or we have no record of it.
    return { transitioned: false, reason: "already_final" };
  }

  const order = data as OrderRow;
  await publishAlert(order);
  await publishGoalUpdate();
  // The conditional UPDATE above already decided a single winner, so the /live
  // feed inherits the same exactly-once property the overlay has — no extra
  // guard needed here. Unlike publishAlert this fires unconditionally: the feed
  // is the creator's own view and shows hidden and held tips too.
  await publishLiveUpdate(order);
  // §6 step 3: mirror this succeeded tip to the wishlist while it features an
  // item. No-op for local goals; never throws. The sweep pull is the backstop.
  await pushTipCredit(order);
  return { transitioned: true, order };
}

// Admin override: force SUCCESS from any state, including FAILED, and re-arm
// the alert so it plays even if this order was announced before. This is the
// last-resort recovery tool, so it deliberately ignores the guards above.
export async function forceSuccess(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "SUCCESS", alert_played_at: null })
    .eq("payment_intent_id", paymentIntentId)
    .select()
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("forceSuccess failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }

  const order = data as OrderRow;
  await publishAlert(order);
  await publishGoalUpdate();
  await publishLiveUpdate(order);
  // §6 step 3: an admin force-success is still a succeeded tip — mirror it too.
  await pushTipCredit(order);
  return { transitioned: true, order };
}

// Privacy & moderation queue actions. Unlike promoteToSuccess/forceSuccess,
// these don't touch `status` at all — a held order may still be PENDING (not
// yet paid) or already SUCCESS (paid before the creator got to the queue).
// Only `moderation_status` moves; if the order already succeeded, approving
// fires the alert now since publishAlert withheld it the first time.
export async function approveModerated(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ moderation_status: "approved" })
    .eq("payment_intent_id", paymentIntentId)
    .eq("moderation_status", "held")
    .select()
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("approveModerated failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }

  const order = data as OrderRow;
  if (order.status === "SUCCESS") await publishAlert(order);
  // Always — an approval decided on one device should clear the "needs a look"
  // badge on any other device watching the feed, whether or not it announced.
  await publishLiveUpdate(order);
  return { transitioned: true, order };
}

// Held → blocked. Permanent — there is no "unblock" action; a mistaken block
// is fixed by hand, the same way a mistaken delete anywhere else in this
// codebase is.
export async function blockModerated(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ moderation_status: "blocked" })
    .eq("payment_intent_id", paymentIntentId)
    .eq("moderation_status", "held")
    .select()
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("blockModerated failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }

  const order = data as OrderRow;
  await publishLiveUpdate(order);
  return { transitioned: true, order };
}

// PENDING/EXPIRED → FAILED, for a canceled Stripe intent. No publishAlert —
// there is nothing to announce. SUCCESS is excluded by the .in() so a row that
// already succeeded (e.g. webhook won the race) is never walked backwards.
export async function markFailed(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "FAILED" })
    .eq("payment_intent_id", paymentIntentId)
    .in("status", ["PENDING", "EXPIRED"])
    .select()
    .maybeSingle();

  if (error) {
    console.error("markFailed failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }
  if (!data) {
    return { transitioned: false, reason: "already_final" };
  }

  const order = data as OrderRow;
  await publishLiveUpdate(order);
  return { transitioned: true, order };
}

// A refund or chargeback on a previously-succeeded tip (webhook: charge.refunded
// / charge.dispute.created). Stamps reversed_at so the tip-goal bridge's
// goal-credits route reports the order as no-longer-SUCCESS and the wishlist
// voids its mirrored credit (PLAN §6 step 4, in the wishlist repo). Deliberately
// does NOT touch `status`: this site's own SUCCESS-based reporting is unchanged;
// only the bridge reads reversed_at. Idempotent via the `is null` guard, so a
// dispute following a refund (or a retried event) is a harmless no-op.
export async function markReversed(paymentIntentId: string): Promise<PromoteResult> {
  const { data, error } = await supabase
    .from("orders")
    .update({ reversed_at: new Date().toISOString() })
    .eq("payment_intent_id", paymentIntentId)
    .is("reversed_at", null)
    .select()
    .maybeSingle();

  if (error) {
    console.error("markReversed failed", paymentIntentId, error.message);
    return { transitioned: false, reason: "not_found" };
  }
  if (!data) {
    // Already reversed, or no order for this intent (e.g. a refund of a tip that
    // predates the Supabase cutover). Neither is worth a retry.
    return { transitioned: false, reason: "already_final" };
  }
  return { transitioned: true, order: data as OrderRow };
}

// PENDING → EXPIRED for anything past the QR's lifetime. Returns how many rows
// moved. Only PENDING is touched, so a tip that succeeded in the meantime is
// never walked backwards.
export async function expireStalePending(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "EXPIRED" })
    .eq("status", "PENDING")
    .lt("created_at", cutoff)
    .select("payment_intent_id");

  if (error) {
    console.error("expireStalePending failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// Best-effort cleanup of the webhook idempotency ledger. Stripe stops retrying
// after ~3 days, so anything past the TTL can never dedupe a live delivery
// again. Never throws — a failed purge must not fail the sweep.
export async function purgeProcessedEvents(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from("processed_stripe_events")
    .delete()
    .lt("processed_at", cutoff)
    .select("stripe_event_id");
  if (error) {
    console.error("purgeProcessedEvents failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// Best-effort cleanup of the rate-limit counters (see try_consume_rate in
// supabase/schema.sql). A fixed-window row is dead weight the moment its
// window has lapsed with no further requests, so anything older than the TTL
// can be dropped. Never throws — a failed purge must not fail the sweep.
export async function purgeStaleRateLimits(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from("rate_limits")
    .delete()
    .lt("window_start", cutoff)
    .select("key");
  if (error) {
    console.error("purgeStaleRateLimits failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
