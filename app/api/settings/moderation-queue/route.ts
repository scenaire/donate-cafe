import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";

// Session-gated: every held order, oldest first. A held order is a real
// payment that already succeeded (or is still in flight) — this list is only
// about whether its name/message have been cleared to show publicly.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("orders")
    .select("payment_intent_id, customer_name, message, amount_minor, currency, created_at, moderation_reason, moderation_word")
    .eq("moderation_status", "held")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Failed to list moderation queue", error.message);
    return NextResponse.json({ error: "Could not fetch the queue." }, { status: 500 });
  }

  return NextResponse.json({ queue: data ?? [] });
}
