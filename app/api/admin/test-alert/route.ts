import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { publishAlert } from "@/lib/realtime";
import type { OrderRow } from "@/lib/supabase";

// Fire a synthetic alert to the overlay so the owner can confirm OBS is wired up
// without waiting for a real tip. Writes nothing to the DB — it only broadcasts,
// exactly like ../replay, so it can never collide with a real order id or leave a
// row behind. The `test-` id also keeps it out of the widget's ack/reconcile
// path, which only ever looks up `pi_` ids.
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const fake: OrderRow = {
    id: "test",
    payment_intent_id: `test-${Date.now()}`,
    customer_name: "Naire",
    message: "Test alert — your overlay is connected ♡",
    amount_minor: 10000, // ฿100
    currency: "thb",
    show_on_screen: true,
    status: "SUCCESS",
    alert_played_at: null,
    thb_equivalent_minor: 10000,
    fx_rate_to_thb: 1,
    fx_source: "identity",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    moderation_status: "approved",
    tts_ok: true,
    moderation_reason: null,
    moderation_word: null,
    item_th: "มัทฉะลาเต้",
    item_en: "Matcha latte",
    item_photo_url: null,
  };

  await publishAlert(fake);
  console.warn(`Test alert broadcast by ${auth.email}`);
  return NextResponse.json({ ok: true });
}
