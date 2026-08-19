import { NextRequest, NextResponse } from "next/server";
import { supabase, type OrderRow } from "@/lib/supabase";
import { alertPayloadFromOrder } from "@/lib/realtime";
import { isValidWidgetToken } from "@/lib/widget-token";

// Reconciliation feed for the OBS widget: every succeeded, visible tip that has
// not been announced yet.
//
// This used to page through Stripe with a `since` cursor the browser kept in
// localStorage, plus a 6-minute trailing re-scan window to catch PromptPay tips
// that confirmed after their intent was created. All of that is gone —
// `alert_played_at IS NULL` answers the same question directly, and it can't
// drift, can't be lost on reload, and can't silently drop the oldest rows when
// a burst exceeds a page limit.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!(await isValidWidgetToken(token))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "SUCCESS")
    .eq("show_on_screen", true)
    // Held/blocked tips stay off the reconciliation feed too — otherwise the
    // widget's 30s poll would surface them the moment publishAlert's initial
    // gate (lib/realtime.ts) skips the broadcast. Approving one in the queue
    // flips this to 'approved' and calls publishAlert itself.
    .eq("moderation_status", "approved")
    .is("alert_played_at", null)
    // Oldest first so a backlog plays in the order the tips arrived.
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Failed to load pending alerts", error.message);
    return NextResponse.json({ error: "Could not fetch alerts." }, { status: 500 });
  }

  return NextResponse.json({
    alerts: (data as OrderRow[]).map(alertPayloadFromOrder),
  });
}
