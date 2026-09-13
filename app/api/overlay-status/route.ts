import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";

// Live-ish figures for the dashboard's overlay card. Phase 1 shows only what the
// server can actually know without a Twitch/OBS presence system:
//   - alertsToday: succeeded tips that have played on stream since UTC midnight
//   - inQueue:     succeeded, on-screen tips not yet played (the widget's pending
//                  feed — what will fire next time the overlay reconciles)
// No connection dot, no offline-hold: those need presence plumbing that's out of
// Phase 1 scope.
export async function GET() {
  // Raced against the counts below rather than awaited first — see the note in
  // app/api/dashboard/analytics/route.ts.
  const authPromise = requireAdmin();

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  const [auth, today, queue] = await Promise.all([
    authPromise,
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUCCESS")
      .gte("alert_played_at", midnight.toISOString()),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUCCESS")
      .eq("show_on_screen", true)
      .is("alert_played_at", null),
  ]);
  if (!auth.ok) return auth.response;

  if (today.error || queue.error) {
    console.error("overlay-status: count failed", today.error?.message ?? queue.error?.message);
    return NextResponse.json({ error: "Could not read overlay status." }, { status: 500 });
  }

  return NextResponse.json({ alertsToday: today.count ?? 0, inQueue: queue.count ?? 0 });
}
