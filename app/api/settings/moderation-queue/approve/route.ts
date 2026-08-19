import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { approveModerated } from "@/lib/orders";

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
  console.warn(`Moderation approve for ${id} by ${auth.email}`);
  return NextResponse.json({ ok: true });
}
