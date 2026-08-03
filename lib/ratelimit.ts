// Pure helpers backing the per-IP throttle on /api/create-payment-intent.
// The atomic counter itself lives in Postgres (try_consume_rate in
// supabase/schema.sql) — see that file's header for why an in-memory limiter
// is useless across Vercel's isolated lambdas. This module is just the part
// that's cheap to unit test: picking the right client identifier.

// First hop of X-Forwarded-For is the client on Vercel; the rest are proxies.
export function clientKeyFromForwarded(xff: string | null, fallback: string): string {
  const first = xff?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : fallback;
}
