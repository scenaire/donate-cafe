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
  // The treat purchased, if any — snapshotted on the order at submit time
  // (Menu edits/deletes afterward don't change what an already-fired alert
  // shows). Null on a custom-amount tip with no treat selected.
  itemTh: string | null;
  itemEn: string | null;
  photo: string | null;
  // False when Privacy & moderation's TTS action blocked this specific
  // message from being read aloud. The alert itself still shows — this only
  // withholds the spoken message text, not the whole card.
  ttsOk: boolean;
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

// Goal bar overlay updates ride the SAME channel as alerts — same token, same
// "knowing the name is the access control" model, deliberately shared per the
// design ("one token, both die together if you regenerate").
export const GOAL_EVENT = "goal";

export type GoalUpdatePayload = {
  // null means "no active goal" (or one just auto-hid on hitting target) — the
  // overlay renders blank rather than a stale or zeroed bar.
  goal: {
    label: string;
    currency: Currency;
    targetMinor: number;
    raisedMinor: number;
    progress: number;
    showOnOverlay: boolean;
  } | null;
};
