// Token-gated reconciliation source for the wishlist's bidirectional pull
// (PLAN §6 step 4, in the wishlist repo). Returns every order in the active
// wishlist-goal window WITH its current status — not only succeeded ones,
// because that status is exactly what lets the wishlist VOID a credit whose tip
// was later refunded or charged back. The pull is the ONLY thing that catches a
// late chargeback — no webhook in this flow will.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.BRIDGE_SHARED_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("starts_at, kind")
    .eq("is_active", true)
    .maybeSingle();
  if (goalError) {
    console.error("goal-credits: goal query failed", goalError.message);
    return NextResponse.json({ error: "Failed to load goal." }, { status: 500 });
  }
  // No active wishlist goal → nothing to reconcile; the wishlist never pushed
  // credits outside a featured window either.
  if (!goal || goal.kind !== "wishlist") return NextResponse.json({ orders: [] });

  // Bound by BOTH the caller's `since` and the goal's start — the same "every
  // succeeded order since starts_at" rule goals already use (§6 step 3). This
  // is what stops the pull inserting tips from before the item was featured.
  const startsAt = goal.starts_at as string;
  const sinceParam = req.nextUrl.searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const sinceIso = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate.toISOString() : startsAt;
  const effectiveSince = sinceIso > startsAt ? sinceIso : startsAt;

  const { data: rows, error } = await supabase
    .from("orders")
    .select("payment_intent_id, status, reversed_at, amount_minor, currency, thb_equivalent_minor, customer_name, show_on_screen, created_at")
    .gte("created_at", effectiveSince)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("goal-credits: orders query failed", error.message);
    return NextResponse.json({ error: "Failed to load orders." }, { status: 500 });
  }

  const orders = [];
  for (const o of rows ?? []) {
    const amountThbMinor = o.thb_equivalent_minor ?? (o.currency === "thb" ? o.amount_minor : null);
    // Can't credit a non-THB tip with no THB snapshot; it was also never
    // mirrored, so it can't be voided either — dropping it is safe both ways.
    if (!amountThbMinor || amountThbMinor <= 0) continue;
    const isAnonymous = !o.show_on_screen;
    orders.push({
      paymentIntentId: o.payment_intent_id,
      // A reversed order (refund/chargeback) is surfaced as non-SUCCESS so the
      // wishlist voids its mirrored credit — the entire point of the pull's
      // void direction (§6 step 4). `status` itself is left untouched upstream.
      status: o.reversed_at ? "FAILED" : o.status,
      amountThbMinor,
      originalAmountMinor: o.amount_minor,
      originalCurrency: o.currency,
      tipperName: isAnonymous ? null : o.customer_name,
      isAnonymous,
      occurredAt: o.created_at,
    });
  }

  return NextResponse.json({ orders });
}
