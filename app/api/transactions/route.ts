import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase, type OrderRow } from "@/lib/supabase";

const PAGE_SIZE = 100;
const STATUSES = new Set(["PENDING", "SUCCESS", "EXPIRED", "FAILED"]);

// Admin transaction list. Now reads the DB behind a Supabase Auth session
// instead of paging Stripe behind a URL token.
//
// Two things got simpler in the move:
//
//  * Search and status filtering are WHERE clauses over the whole table. The
//    Stripe version could only filter rows a cursor had already fetched, so you
//    could not find a tip that wasn't on screen yet.
//  * Pagination is a plain created_at keyset. Stripe's `starting_after` had to
//    be taken from the raw page rather than the filtered list, or whole pages of
//    filtered-out rows would stall the cursor — a subtlety that no longer exists.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const params = req.nextUrl.searchParams;
  const before = params.get("before"); // ISO timestamp keyset cursor
  const status = params.get("status");
  const q = params.get("q")?.trim() ?? "";

  let query = supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1); // one extra row tells us whether more exist

  if (before) {
    const asDate = new Date(before);
    if (Number.isNaN(asDate.getTime())) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    query = query.lt("created_at", asDate.toISOString());
  }

  if (status && STATUSES.has(status)) {
    query = query.eq("status", status);
  }

  if (q) {
    // Escape PostgREST's or() delimiters so a comma or paren in the search box
    // can't break out of the filter expression.
    const safe = q.replace(/[,()\\]/g, " ").slice(0, 100);
    if (safe.trim()) {
      query = query.or(`customer_name.ilike.%${safe}%,message.ilike.%${safe}%`);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to list orders", error.message);
    return NextResponse.json({ error: "Could not fetch transactions." }, { status: 500 });
  }

  const rows = (data ?? []) as OrderRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    transactions: page.map((o) => ({
      id: o.payment_intent_id,
      createdAt: Math.floor(new Date(o.created_at).getTime() / 1000),
      name: o.customer_name,
      message: o.message ?? "",
      amountMinor: o.amount_minor,
      currency: o.currency,
      showOnScreen: o.show_on_screen,
      status: o.status,
      alertPlayedAt: o.alert_played_at,
    })),
    hasMore,
    nextCursor: page.length ? page[page.length - 1].created_at : null,
  });
}
