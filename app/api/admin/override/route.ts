import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { forceSuccess } from "@/lib/orders";

// SRS 1.2 — manual override. The last-resort recovery tool for an order the
// automatic paths could not resolve.
//
// The requirement that matters: this must produce the *same* Realtime event a
// real Stripe webhook would, so the OBS alert and TTS fire on stream exactly as
// if the payment had arrived naturally. That is why it calls forceSuccess →
// publishAlert rather than assembling its own broadcast — there is one code
// path to alerting, so the two can't drift apart.
//
// forceSuccess also clears alert_played_at, which is what lets you re-fire an
// alert that was missed or eaten, not just correct a status.
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

  const result = await forceSuccess(id);
  if (!result.transitioned) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  console.warn(`Manual override → SUCCESS for ${id} by ${auth.email}`);
  return NextResponse.json({ ok: true, status: result.order.status });
}
