// Channel contract for the /live feed, shared by the server that broadcasts
// (lib/live.ts) and the page that subscribes (app/live/page.tsx).
//
// Same split, and the same reason, as lib/realtime.shared.ts: the page is a
// "use client" module, so it must never be able to reach lib/live.ts and pull
// the service-role Supabase client into the browser bundle. Keeping the shared
// surface free of server imports makes that a compile-time impossibility rather
// than a code-review habit.
//
// Nothing here touches the network or reads a secret.

import type { Currency } from "./money";
import type { OrderStatus, OrderModerationStatus } from "./supabase";

export const LIVE_EVENT = "order";

// One row of the feed. Deliberately a superset of AlertPayload: the whole point
// of a separate channel is that this one carries orders the overlay refuses —
// held tips awaiting a decision, hidden tips, failures — because those are
// exactly what the creator wants to see while streaming.
export type LivePayload = {
  id: string; // payment_intent_id — the feed dedupes and re-keys on this
  createdAt: number; // unix seconds
  name: string;
  message: string;
  amountMinor: number;
  currency: Currency;
  status: OrderStatus;
  moderation: OrderModerationStatus;
  showOnScreen: boolean;
  alertPlayedAt: string | null;
  itemTh: string | null;
  itemEn: string | null;
  photo: string | null;
};

// Deliberately no "what changed" flag on the wire. The page decides whether an
// arriving row deserves a chime by diffing it against the row it already holds
// (unknown id, or a known id that wasn't SUCCESS and now is). That makes the
// broadcast path and the reconciliation-poll path produce identical behaviour
// from identical data, instead of the poll having to synthesise a flag the
// server would have set.

// The channel name embeds the live token, mirroring the alert channel's model.
// The difference that matters: live_token is never placed in a URL and is only
// served to a caller that has already passed requireAdmin(), so the admin
// session — not knowledge of a link — is what actually gates this feed.
export function liveChannelName(token: string): string {
  return `live-${token}`;
}
