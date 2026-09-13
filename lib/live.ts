// SERVER SIDE of the /live feed channel. See lib/live.shared.ts for the wire
// contract and why it lives in a separate file.
//
// This is the deliberate counterpart to publishAlert(): where that function
// gates hard (hidden tips and un-approved tips never reach the overlay), this
// one gates not at all. The creator's own monitoring view is the one place that
// should see a held message — it is what they act on when they decide whether
// to approve it.
//
// That difference in audience is the entire reason this is a second channel
// with a second secret rather than another event on the alert channel: anyone
// holding the OBS browser-source URL knows the alert channel's name, and held
// message content must not be reachable that way.

import { supabase, type OrderRow } from "./supabase";
import { LIVE_EVENT, liveChannelName, type LivePayload } from "./live.shared";

export { LIVE_EVENT, liveChannelName };
export type { LivePayload };

export async function getLiveToken(): Promise<string | null> {
  const { data, error } = await supabase
    .from("cafe_settings")
    .select("live_token")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error("Failed to load live token", error.message);
    return null;
  }
  return (data?.live_token as string | undefined) ?? null;
}

export function livePayloadFromOrder(order: OrderRow): LivePayload {
  return {
    id: order.payment_intent_id,
    createdAt: Math.floor(new Date(order.created_at).getTime() / 1000),
    name: order.customer_name,
    message: order.message ?? "",
    amountMinor: order.amount_minor,
    currency: order.currency,
    status: order.status,
    moderation: order.moderation_status,
    showOnScreen: order.show_on_screen,
    alertPlayedAt: order.alert_played_at,
    itemTh: order.item_th,
    itemEn: order.item_en,
    photo: order.item_photo_url,
  };
}

// Fire-and-forget. Never throws — same contract as publishAlert, and for the
// same reason: this is called from inside the webhook's transaction path, and a
// Realtime hiccup must not make us return non-2xx to Stripe for an event we have
// already applied. The feed's 30s reconciliation poll is what makes that safe;
// a dropped broadcast costs freshness, not a lost message.
export async function publishLiveUpdate(order: OrderRow): Promise<void> {
  const token = await getLiveToken();
  if (!token) {
    console.warn("publishLiveUpdate: live_token unset — feed not notified");
    return;
  }

  try {
    // httpSend() POSTs to Realtime's HTTP broadcast endpoint instead of opening
    // a websocket — the right shape for a serverless function that lives for
    // milliseconds. See publishAlert in lib/realtime.ts for why this is httpSend
    // rather than send(), and why the catch below is what actually handles a
    // failed broadcast.
    const channel = supabase.channel(liveChannelName(token));
    const res = await channel.httpSend(LIVE_EVENT, livePayloadFromOrder(order));
    if (!res.success) {
      console.warn(`publishLiveUpdate: broadcast failed (${res.status}) for ${order.payment_intent_id}: ${res.error}`);
    }
  } catch (err) {
    console.error("publishLiveUpdate failed", err);
  }
}
