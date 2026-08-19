import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase, type OrderRow } from "@/lib/supabase";
import { formatMoney, isCurrency } from "@/lib/money";
import { applyTxFilter, parseTxFilter } from "@/lib/tx-filter";

const EXPORT_CAP = 5000;

// CSV of the current filtered view (respects the same search/visibility/status
// filters as the table), so the owner can pull tips into a spreadsheet. All
// matching rows up to a cap, not just the visible page.
function csvCell(value: string): string {
  // Quote-wrap and escape; also neutralise spreadsheet formula injection by
  // prefixing a leading =/+/-/@ with a single quote.
  const v = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${v.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const params = req.nextUrl.searchParams;
  const filter = parseTxFilter(params.get("filter"));
  const q = params.get("q")?.trim() ?? "";

  let query = applyTxFilter(
    supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(EXPORT_CAP),
    filter
  );

  if (q) {
    const safe = q.replace(/[,()\\]/g, " ").slice(0, 100);
    if (safe.trim()) query = query.or(`customer_name.ilike.%${safe}%,message.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("transactions export failed", error.message);
    return NextResponse.json({ error: "Could not export transactions." }, { status: 500 });
  }

  const header = ["Time", "Name", "Amount", "Currency", "On stream", "Status", "Message"];
  const lines = [header.map(csvCell).join(",")];
  for (const o of (data ?? []) as OrderRow[]) {
    const amount = isCurrency(o.currency) ? formatMoney(o.amount_minor, o.currency) : String(o.amount_minor);
    lines.push(
      [
        new Date(o.created_at).toISOString(),
        o.customer_name,
        amount,
        o.currency.toUpperCase(),
        o.show_on_screen ? "yes" : "no",
        o.status,
        o.message ?? "",
      ]
        .map((c) => csvCell(String(c)))
        .join(",")
    );
  }

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="whispering-rain-tips-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
