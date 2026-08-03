// Browser-side Supabase client, built on the ANON key.
//
// Safe to ship: supabase/schema.sql enables RLS on every table with no policies
// at all, so this key grants zero table access. It exists for two things that
// don't touch tables — the alert widget's Realtime Broadcast subscription, and
// the dashboard's auth session.
//
// If you ever add an RLS policy for `anon`, re-read lib/realtime.ts first: the
// no-anon-access rule is what lets the alert channel carry names, messages and
// amounts safely.

import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
