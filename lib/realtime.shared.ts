// The parts of the alert channel contract that BOTH sides need: the server that
// broadcasts (lib/realtime.ts) and the browser widget that subscribes
// (app/alert/page.tsx).
//
// This file exists purely so the widget never has to import lib/realtime.ts,
// which pulls in the service-role Supabase client. A single stray import of
// that module from a "use client" file would bundle the service-role key into
// the browser and expose every order ever placed. Keeping the shared surface
// free of server imports makes that mistake impossible rather than merely
// discouraged.
//
// Nothing here touches the network or reads a secret.

import type { Currency } from "./money";

export const ALERT_EVENT = "alert";

export type AlertPayload = {
  id: string; // payment_intent_id — the widget dedupes on this
  createdAt: number; // unix seconds
  name: string;
  message: string;
  amountMinor: number;
  currency: Currency;
  // Set only by the admin replay route. The widget dedupes on `id` for the
  // lifetime of the page, which would silently swallow a deliberate
  // re-announce of a tip that already played — the one case the replay button
  // exists for. This flag is the widget's signal to bypass that check, to
  // ignore the minAmount/ttsMin thresholds (an explicit click outranks a
  // blanket filter), and to skip the ack, since the row is already stamped.
  replay?: true;
};

// The channel name embeds the widget token. That is the access control: the
// orders table is closed to anon entirely, so knowing this name is the only way
// to receive alerts — the same bar as knowing the OBS URL today.
export function channelName(token: string): string {
  return `alerts-${token}`;
}
