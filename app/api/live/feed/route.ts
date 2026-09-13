import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase, type OrderRow } from "@/lib/supabase";
import { getLiveToken, livePayloadFromOrder } from "@/lib/live";

// Backing store for /live: the initial page load AND the reconciliation poll.
//
// It returns the channel token alongside the rows deliberately. The page needs
// both before it can do anything, and folding them into one request removes a
// round trip from the moment the creator is most likely to be mid-game and
// impatient. It also means the token has exactly one exit path from the server,
// gated by requireAdmin() — there is no separate token endpoint to forget to
// protect.
//
// The token is returned in the BODY, never a URL. Unlike the widget token
// (which lives in an OBS browser-source URL and is therefore semi-public by
// construction), this one is only ever held by an authenticated admin session,
// which is what allows the feed to carry held and hidden message text.

const FEED_LIMIT = 50;

export async function GET() {
  // Raced against the reads below rather than awaited first — see the note in
  // app/api/dashboard/analytics/route.ts. Nothing is returned unless it passes.
  const authPromise = requireAdmin();

  // EXPIRED is excluded here, not just hidden in the client. An expired PromptPay
  // QR is someone who never paid — it's the most common row in the table and it
  // carries nothing worth reading, so on a glanceable feed it would crowd out the
  // rows that matter. Filtering server-side also means the 50-row budget is spent
  // entirely on tips the creator actually wants to see. /dashboard still shows
  // them; this view is not the audit trail.
  const ordersQuery = supabase
    .from("orders")
    .select("*")
    .neq("status", "EXPIRED")
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  const [auth, tokenResult, ordersResult] = await Promise.all([
    authPromise,
    getLiveToken(),
    ordersQuery,
  ]);
  if (!auth.ok) return auth.response;

  if (ordersResult.error) {
    console.error("live feed: query failed", ordersResult.error.message);
    return NextResponse.json({ error: "Could not load the feed." }, { status: 500 });
  }

  return NextResponse.json({
    token: tokenResult,
    orders: ((ordersResult.data ?? []) as OrderRow[]).map((o) => livePayloadFromOrder(o)),
  });
}
