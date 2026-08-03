import Stripe from "stripe";

let client: Stripe | null = null;

// Outside production (i.e. `next dev` and tests) prefer the test-mode secret so
// local work can never move real money, falling back to the live key if no test
// key is set. In production only STRIPE_SECRET_KEY is ever read. The publishable
// key in app/page.tsx switches on the same NODE_ENV check, so the two halves are
// always the same mode and can't mismatch.
export function stripeSecretKey(): string | undefined {
  if (process.env.NODE_ENV === "production") return process.env.STRIPE_SECRET_KEY;
  return process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
}

function getClient(): Stripe {
  if (client) return client;

  const key = stripeSecretKey();
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY environment variable");

  // Pinned so a Stripe-side API rollout can't silently change response shapes
  // under us. Matches the version this SDK's types were generated against —
  // bump both together when upgrading `stripe`.
  client = new Stripe(key, {
    apiVersion: "2026-06-24.dahlia",
  });
  return client;
}

// Lazy behind a Proxy rather than constructed at module load — see
// lib/supabase.ts for the identical rationale. `next build` imports every
// route module to collect page data, so a top-level `new Stripe(...)` would
// require STRIPE_SECRET_KEY at BUILD time too. Deferring to first property
// access turns a missing key into a runtime error on the affected request
// instead of a broken deploy.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getClient() as object, prop, receiver);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});
