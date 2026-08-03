import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase, type OrderRow } from "@/lib/supabase";
import { publishAlert } from "@/lib/realtime";

// Re-announce a tip that already played on stream.
//
// The sibling route (../override) exists to *fix* an order — it writes SUCCESS,
// clears alert_played_at, and announces. This one writes nothing at all. The
// order is already correct; the only thing that went wrong is that you missed
// hearing it. So a replay is a pure broadcast, and alert_played_at keeps
// meaning "when this tip first played" rather than "when it last played" —
// which is the answer you actually want out of that column when reconciling.
//
// Not in lib/orders.ts on purpose: that module is the home of state
// transitions, and this is not one.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const id = b.paymentIntentId;
  if (typeof id !== "string" || !id.startsWith("pi_")) {
    return NextResponse.json({ error: "Invalid paymentIntentId." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("payment_intent_id", id)
    .maybeSingle();

  if (error) {
    console.error("replay: failed to load order", id, error.message);
    return NextResponse.json({ error: "Could not load order." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const order = data as OrderRow;

  // Both checks are enforced here rather than only in the dashboard, because
  // the button being hidden is a convenience, not a control.
  //
  //  * Non-SUCCESS: announcing a tip whose money never arrived is a mistake
  //    made in front of viewers. Promoting it first is what ../override is for.
  //  * Hidden: the payer asked to stay off-screen, and nothing an admin clicks
  //    should overrule that. publishAlert would refuse anyway; failing loudly
  //    here means the UI can say so instead of appearing to succeed.
  if (order.status !== "SUCCESS") {
    return NextResponse.json(
      { error: "Only succeeded orders can be replayed." },
      { status: 409 }
    );
  }
  if (!order.show_on_screen) {
    return NextResponse.json(
      { error: "This tip is hidden from the overlay." },
      { status: 409 }
    );
  }

  await publishAlert(order, { replay: true });

  console.warn(`Alert replay for ${id} by ${auth.email}`);
  return NextResponse.json({ ok: true });
}
