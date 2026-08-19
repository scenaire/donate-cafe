import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import { isCurrency } from "@/lib/money";

// Read-only Stripe balance for the payout card. One Balance API call; the actual
// moving of money stays in the Stripe dashboard (the client renders a deep-link),
// so nothing here can initiate a transfer — matching the SRS's read-only rule.
//
// Balance is per-currency (the account holds separate THB/USD/JPY buckets now
// that foreign cards are charged in their own currency), so we return each bucket
// the account actually has rather than flattening to one figure.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const balance = await stripe.balance.retrieve();

    const collect = (list: { amount: number; currency: string }[]) =>
      list
        .filter((b) => isCurrency(b.currency))
        .map((b) => ({ currency: b.currency, amountMinor: b.amount }));

    return NextResponse.json({
      available: collect(balance.available ?? []),
      pending: collect(balance.pending ?? []),
      dashboardUrl: "https://dashboard.stripe.com/balance",
    });
  } catch (err) {
    console.error("payout: Stripe balance read failed", err);
    return NextResponse.json({ error: "Could not read Stripe balance." }, { status: 502 });
  }
}
