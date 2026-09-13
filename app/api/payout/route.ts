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
// Stripe's Balance API is the slowest hop on the dashboard's first paint and the
// figure barely moves (payouts settle on Stripe's own schedule), so a short
// process-local cache keeps a re-navigation or a second tab off the wire. Not
// shared across serverless instances — it's a latency trim, not a cache layer.
const BALANCE_TTL_MS = 30_000;
type BalanceCache = { at: number; body: unknown };
let balanceCache: BalanceCache | null = null;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (balanceCache && Date.now() - balanceCache.at < BALANCE_TTL_MS) {
    return NextResponse.json(balanceCache.body);
  }

  try {
    const balance = await stripe.balance.retrieve();

    const collect = (list: { amount: number; currency: string }[]) =>
      list
        .filter((b) => isCurrency(b.currency))
        .map((b) => ({ currency: b.currency, amountMinor: b.amount }));

    const body = {
      available: collect(balance.available ?? []),
      pending: collect(balance.pending ?? []),
      dashboardUrl: "https://dashboard.stripe.com/balance",
    };
    balanceCache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    console.error("payout: Stripe balance read failed", err);
    return NextResponse.json({ error: "Could not read Stripe balance." }, { status: 502 });
  }
}
