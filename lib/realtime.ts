// Alert delivery over Supabase Realtime Broadcast. SERVER SIDE of the channel.
//
// Why Broadcast and not postgres_changes:
//
// The obvious design is to have /alert subscribe to INSERT/UPDATE on `orders`.
// But postgres_changes enforces Row Level Security, so for the widget to
// receive names, messages and amounts, the anon role would need read access to
// exactly the columns ALERT_WIDGET_TOKEN exists to protect — and the anon key
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
import { ALERT_EVENT, channelName, type AlertPayload } from "./realtime.shared";

// Re-exported so server callers have one import site; the definitions live in
// realtime.shared.ts because the browser widget needs them too and must not
// reach this module (see that file's header).
export { ALERT_EVENT, channelName };
export type { AlertPayload };

export function alertPayloadFromOrder(order: OrderRow): AlertPayload {
  return {
    id: order.payment_intent_id,
    createdAt: Math.floor(new Date(order.created_at).getTime() / 1000),
    name: order.customer_name,
    message: order.message ?? "",
    amountMinor: order.amount_minor,
    currency: order.currency,
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
  const token = process.env.ALERT_WIDGET_TOKEN;
  if (!token) {
    console.warn("publishAlert: ALERT_WIDGET_TOKEN unset — alert not broadcast");
    return;
  }
  if (!order.show_on_screen) return; // hidden tips never reach the overlay

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
