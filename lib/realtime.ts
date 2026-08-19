// Alert delivery over Supabase Realtime Broadcast. SERVER SIDE of the channel.
//
// Why Broadcast and not postgres_changes:
//
// The obvious design is to have /alert subscribe to INSERT/UPDATE on `orders`.
// But postgres_changes enforces Row Level Security, so for the widget to
// receive names, messages and amounts, the anon role would need read access to
// exactly the columns the widget token exists to protect — and the anon key
// is public by design. The v2 SRS asks for both of those things at once and
// they cannot both hold.
//
// So the server broadcasts instead, on a channel whose NAME embeds the widget
// token. `orders` stays completely closed to anon (no RLS policies at all), and
// the security model is exactly the one already in place: whoever knows the
// token can see the alerts.
//
// Both the webhook and the manual-override route publish through this one
// function and nothing else. That is what makes an admin override produce a
// byte-identical event to a real payment, which SRS 1.2 requires so the on-
// stream alert and TTS fire the same way.

import { supabase } from "./supabase";
import type { OrderRow } from "./supabase";
import { ALERT_EVENT, GOAL_EVENT, channelName, type AlertPayload, type GoalUpdatePayload } from "./realtime.shared";
import { getWidgetToken } from "./widget-token";
import { computeGoalSummary } from "./goal";

// Re-exported so server callers have one import site; the definitions live in
// realtime.shared.ts because the browser widget needs them too and must not
// reach this module (see that file's header).
export { ALERT_EVENT, GOAL_EVENT, channelName };
export type { AlertPayload, GoalUpdatePayload };

export function alertPayloadFromOrder(order: OrderRow): AlertPayload {
  return {
    id: order.payment_intent_id,
    createdAt: Math.floor(new Date(order.created_at).getTime() / 1000),
    name: order.customer_name,
    message: order.message ?? "",
    amountMinor: order.amount_minor,
    currency: order.currency,
    itemTh: order.item_th,
    itemEn: order.item_en,
    photo: order.item_photo_url,
    ttsOk: order.tts_ok,
  };
}

// Fire-and-forget. Never throws.
//
// A failed broadcast must not fail the webhook — returning non-2xx to Stripe
// would make it retry an event we have already applied to the database. The
// widget's reconciliation poll picks up anything that misses this path (that is
// the entire reason the poll still exists alongside Realtime), so the cost of a
// dropped broadcast is latency, not a lost alert.
//
// `replay` marks an admin-initiated re-announce of a tip that already played.
// It changes nothing here beyond a flag on the payload — the guard below still
// applies, so a hidden tip stays hidden no matter who asks. What it does is
// tell the widget to stop treating this id as already-seen; see
// realtime.shared.ts. Note that the poll has no replay concept: a replay lives
// or dies with this one broadcast, which is deliberate — a replay pressed while
// OBS is closed should evaporate, not ambush you an hour later.
export async function publishAlert(
  order: OrderRow,
  opts?: { replay?: boolean }
): Promise<void> {
  const token = await getWidgetToken();
  if (!token) {
    console.warn("publishAlert: widget_token unset — alert not broadcast");
    return;
  }
  if (!order.show_on_screen) return; // hidden tips never reach the overlay
  // Held/blocked tips never reach the overlay either — approving one in the
  // Privacy & moderation queue calls publishAlert again itself, which is what
  // actually announces it. Covers every caller (webhook, sweep, override,
  // replay) from this one gate.
  if (order.moderation_status !== "approved") return;

  try {
    // send() on an unsubscribed channel POSTs to Realtime's HTTP broadcast
    // endpoint rather than opening a websocket — the right shape for a
    // serverless function that lives for milliseconds.
    const channel = supabase.channel(channelName(token));
    const res = await channel.send({
      type: "broadcast",
      event: ALERT_EVENT,
      payload: opts?.replay
        ? { ...alertPayloadFromOrder(order), replay: true as const }
        : alertPayloadFromOrder(order),
    });
    if (res !== "ok") {
      console.warn(`publishAlert: broadcast returned "${res}" for ${order.payment_intent_id}`);
    }
  } catch (err) {
    console.error("publishAlert failed", err);
  }
}

// Called wherever an order genuinely transitions to SUCCESS (promoteToSuccess,
// forceSuccess) — NOT from approveModerated, since the goal total is a
// financial fact counted the moment status became SUCCESS, regardless of
// whether the alert was withheld pending moderation. Unlike publishAlert,
// there's no show_on_screen/moderation gate here — a held or hidden tip still
// moved money and still counts toward the goal.
//
// Fire-and-forget, same reasoning as publishAlert: a dropped broadcast costs
// the overlay's next poll a few seconds of staleness, not correctness.
export async function publishGoalUpdate(): Promise<void> {
  const token = await getWidgetToken();
  if (!token) return;

  const summary = await computeGoalSummary();
  const payload: GoalUpdatePayload = {
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
  };

  try {
    const channel = supabase.channel(channelName(token));
    const res = await channel.send({ type: "broadcast", event: GOAL_EVENT, payload });
    if (res !== "ok") {
      console.warn(`publishGoalUpdate: broadcast returned "${res}"`);
    }
  } catch (err) {
    console.error("publishGoalUpdate failed", err);
  }
}
