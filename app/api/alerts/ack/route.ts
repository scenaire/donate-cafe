import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// The fix for the alert-replay bug.
//
// Before Supabase, "already announced" lived in an in-memory Set in the widget
// while the polling cursor was persisted to localStorage six minutes behind.
// Reloading the OBS Browser Source therefore wiped the Set but kept the cursor,
// and every succeeded tip inside that window re-announced itself — card, chime
// and TTS. Moving the flag server-side makes it survive reloads, crashes,
// scene switches and duplicated sources, because none of those can reset it.
//
// The widget calls this after an alert has finished playing, not when it starts:
// if OBS dies mid-animation we would rather replay one tip than silently eat it.
export async function POST(req: NextRequest) {
  const expected = process.env.ALERT_WIDGET_TOKEN;
  const token = req.nextUrl.searchParams.get("token");
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const ids = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
    return NextResponse.json({ error: "Expected 1–100 ids." }, { status: 400 });
  }
  const clean = ids.filter((id): id is string => typeof id === "string" && id.startsWith("pi_"));
  if (clean.length === 0) {
    return NextResponse.json({ error: "No valid ids." }, { status: 400 });
  }

  // Only stamp rows that have not been stamped yet, so a duplicate ack can't
  // move the timestamp and confuse "when did this actually play".
  const { data, error } = await supabase
    .from("orders")
    .update({ alert_played_at: new Date().toISOString() })
    .in("payment_intent_id", clean)
    .is("alert_played_at", null)
    .select("payment_intent_id");

  if (error) {
    console.error("Failed to ack alerts", error.message);
    return NextResponse.json({ error: "Could not acknowledge alerts." }, { status: 500 });
  }

  return NextResponse.json({ acked: data?.length ?? 0 });
}
