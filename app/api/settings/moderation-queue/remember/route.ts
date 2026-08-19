import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { approveModerated } from "@/lib/orders";
import { supabase } from "@/lib/supabase";
import { loadPrivacyConfig } from "@/lib/moderation";

// Approve + add the word that triggered the hold to the always-allow list, in
// one click — the queue's "Approve and always allow ‘word’" button.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = (body as { paymentIntentId?: unknown })?.paymentIntentId;
  if (typeof id !== "string" || !id.startsWith("pi_")) {
    return NextResponse.json({ error: "Invalid paymentIntentId." }, { status: 400 });
  }

  const result = await approveModerated(id);
  if (!result.transitioned) {
    return NextResponse.json({ error: "Not found in the queue." }, { status: 404 });
  }

  const word = result.order.moderation_word;
  if (word) {
    const cfg = await loadPrivacyConfig();
    if (!cfg.allowWords.some((w) => w.toLowerCase() === word.toLowerCase())) {
      const allowWords = [...cfg.allowWords, word];
      const { error } = await supabase.from("cafe_settings").update({ privacy: { ...cfg, allowWords } }).eq("id", true);
      if (error) console.error("Failed to append allow-word", error.message);
    }
  }

  console.warn(`Moderation remember for ${id} by ${auth.email}`);
  return NextResponse.json({ ok: true });
}
