import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase, type OrderRow } from "@/lib/supabase";
import { applyTxFilter, parseTxFilter } from "@/lib/tx-filter";

const PAGE_SIZE = 12;

// Admin transaction list. Reads the DB behind a Supabase Auth session.
//
// Numbered (offset) pagination with an exact total, so the dashboard can render a
// classic prev/1/2/next pager. Search and the filter are WHERE clauses over the
// whole table (not just the current page).
export async function GET(req: NextRequest) {
  // Raced against the query below rather than awaited first — see the note in
  // app/api/dashboard/analytics/route.ts. No rows are returned unless it passes.
  const authPromise = requireAdmin();

  const params = req.nextUrl.searchParams;
  const filter = parseTxFilter(params.get("filter"));
  const q = params.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = applyTxFilter(
    supabase
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    filter
  );

  if (q) {
    // Escape PostgREST's or() delimiters so a comma or paren in the search box
    // can't break out of the filter expression.
    const safe = q.replace(/[,()\\]/g, " ").slice(0, 100);
    if (safe.trim()) query = query.or(`customer_name.ilike.%${safe}%,message.ilike.%${safe}%`);
  }

  const [auth, { data, error, count }] = await Promise.all([authPromise, query]);
  if (!auth.ok) return auth.response;
  if (error) {
    console.error("Failed to list orders", error.message);
    return NextResponse.json({ error: "Could not fetch transactions." }, { status: 500 });
  }

  const total = count ?? 0;
  return NextResponse.json({
    transactions: ((data ?? []) as OrderRow[]).map((o) => ({
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
    page,
    pageSize: PAGE_SIZE,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
