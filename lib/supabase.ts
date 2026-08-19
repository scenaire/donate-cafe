// Service-role Supabase client. SERVER ONLY.
//
// The service-role key bypasses Row Level Security, which is the whole point:
// supabase/schema.sql enables RLS with no policies, so this client is the only
// thing that can read or write. Never import this module from a "use client"
// file or anything reachable from the browser bundle — the key would ship to
// every visitor and hand them the entire orders table.
//
// Browser-side Supabase usage (the alert widget's Realtime subscription, the
// dashboard's auth session) goes through the anon key instead; see
// lib/realtime.ts and lib/supabase-browser.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Currency } from "./money";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing SUPABASE_URL environment variable");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");

  client = createClient(url, serviceKey, {
    auth: {
      // No user session on the server — this client is pure service-role.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return client;
}

// Lazy behind a Proxy rather than constructed at module load.
//
// `next build` imports every route module to collect page data, so building
// with a top-level `createClient()` would require the Supabase env vars to be
// present at BUILD time as well as run time — the build fails outright without
// them. Deferring construction to first property access means a missing
// variable surfaces as a clear runtime error on the affected request instead of
// a broken deploy, and CI can typecheck and build without production secrets.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getClient() as object, prop, receiver);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});

export type OrderStatus = "PENDING" | "SUCCESS" | "EXPIRED" | "FAILED";
export type OrderModerationStatus = "approved" | "held" | "blocked";

export type OrderRow = {
  id: string;
  payment_intent_id: string;
  customer_name: string;
  message: string | null;
  amount_minor: number;
  currency: Currency;
  show_on_screen: boolean;
  status: OrderStatus;
  alert_played_at: string | null;
  // THB-equivalent snapshot frozen at PENDING creation — see lib/fx.ts. NULL
  // until captured; NULL means "unknown", never "zero".
  thb_equivalent_minor: number | null;
  fx_rate_to_thb: number | null;
  fx_source: "identity" | "cache" | "seed" | "repair" | null;
  created_at: string;
  updated_at: string;
  // Set once at order creation by lib/moderation.ts. Gates the alert pipeline
  // (see publishAlert in lib/realtime.ts) — held/blocked tips still succeed as
  // payments, they just never reach the overlay until approved.
  moderation_status: OrderModerationStatus;
  tts_ok: boolean;
  moderation_reason: string | null;
  moderation_word: string | null;
  // Treat snapshot at submit time — see create-payment-intent's loadItemSnapshot.
  item_th: string | null;
  item_en: string | null;
  item_photo_url: string | null;
};

// Stripe's PaymentIntent statuses mapped onto our four-state machine. Stripe is
// the authority on money, so this is how its truth enters the DB — used by the
// webhook, the sweep, and the backfill so all three agree.
export function statusFromStripe(stripeStatus: string): OrderStatus {
  switch (stripeStatus) {
    case "succeeded":
    // PromptPay hands off to the bank and sits in `processing` until it
    // settles. The payer has paid; treating this as anything less would show
    // them an "expired" screen for a completed payment.
    case "processing":
      return "SUCCESS";
    case "canceled":
      return "FAILED";
    default:
      // requires_payment_method / requires_action / requires_confirmation —
      // still in flight as far as we're concerned.
      return "PENDING";
  }
}
