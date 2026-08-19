import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { CURRENCY_ORDER } from "@/lib/money";
import { CAFE_COPY } from "@/lib/cafe";

// Anonymous is not one supporter — it's everyone who ticked "stay anonymous"
// collapsed onto one placeholder name. Ranking it as a top supporter would be
// meaningless (and usually wins), so it's excluded from that leaderboard. Kept in
// sync with the tip page's anon labels + validate.ts's empty-name default.
const ANON_NAMES = new Set([CAFE_COPY.th.anonName, CAFE_COPY.en.anonName, "Anonymous"].map((s) => s.trim().toLowerCase()));
function isAnon(name: string): boolean {
  return ANON_NAMES.has(name.trim().toLowerCase());
}

// Owner-dashboard analytics, computed route-side from the existing `orders`
// table — no new columns and no new RPCs (Phase 1 runs on existing data).
//
// All money is aggregated in THB via `thb_equivalent_minor`, the snapshot
// frozen at PENDING creation (see lib/fx.ts). That is what lets a mixed-currency
// ledger roll up into one ฿ figure without inventing a rate at read time.
//
// Volumes here are one creator's lifetime tips (hundreds–low thousands), so
// pulling the window's succeeded rows and reducing in JS is fine; if that ever
// stops being true this is the place to add a SUM/GROUP BY RPC.

const ROW_CAP = 10000;

type Range = "month" | "year" | "all";

// A succeeded order reduced to what every metric here needs.
type Row = { name: string; thbMinor: number; created: number; currency: string; amountMinor: number };

function thbMinorOf(o: { thb_equivalent_minor: number | null; currency: string; amount_minor: number }): number {
  if (o.thb_equivalent_minor != null) return o.thb_equivalent_minor;
  // Pre-snapshot / THB rows: the charge already is THB minor units.
  return o.currency === "thb" ? o.amount_minor : 0;
}

// UTC month/year boundaries. Bangkok has no DST so day-bucketing is close enough
// at UTC for Phase 1; a later pass can shift to +07:00 if day edges matter.
function monthStart(y: number, m: number): number {
  return Date.UTC(y, m, 1);
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function parseAnchor(range: Range, anchor: string | null, now: Date): { y: number; m: number } {
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth();
  if (range === "month") {
    const match = /^(\d{4})-(\d{1,2})$/.exec(anchor ?? "");
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]) - 1;
      if (y >= 2000 && y <= 2100 && m >= 0 && m <= 11) return { y, m };
    }
    return { y: ny, m: nm };
  }
  if (range === "year") {
    const match = /^(\d{4})$/.exec(anchor ?? "");
    if (match) {
      const y = Number(match[1]);
      if (y >= 2000 && y <= 2100) return { y, m: 0 };
    }
    return { y: ny, m: 0 };
  }
  return { y: ny, m: nm };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const params = req.nextUrl.searchParams;
  const rangeParam = params.get("range");
  const range: Range = rangeParam === "year" || rangeParam === "all" ? rangeParam : "month";
  const now = new Date();

  // Earliest order bounds the period picker (and the "all" window start).
  const { data: firstRows, error: firstError } = await supabase
    .from("orders")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1);
  if (firstError) {
    console.error("analytics: earliest-order query failed", firstError.message);
    return NextResponse.json({ error: "Could not load analytics." }, { status: 500 });
  }
  const earliest = firstRows?.[0]?.created_at ?? now.toISOString();

  const { y, m } = parseAnchor(range, params.get("anchor"), now);

  // Resolve the current window [from, to), the previous comparable window (for
  // the delta), the chart bucket granularity, and a human title.
  let from: number;
  let to: number;
  let prevFrom: number | null = null;
  let prevTo: number | null = null;
  let bucket: "day" | "month";

  if (range === "month") {
    from = monthStart(y, m);
    to = monthStart(y, m + 1);
    prevFrom = monthStart(y, m - 1);
    prevTo = from;
    bucket = "day";
  } else if (range === "year") {
    from = monthStart(y, 0);
    to = monthStart(y + 1, 0);
    prevFrom = monthStart(y - 1, 0);
    prevTo = from;
    bucket = "month";
  } else {
    from = new Date(earliest).getTime();
    to = now.getTime() + 1;
    bucket = "month";
  }

  // Succeeded rows in the window — the substrate for every KPI, the chart, and
  // the supporter ranking.
  const { data, error } = await supabase
    .from("orders")
    .select("customer_name, amount_minor, currency, thb_equivalent_minor, created_at")
    .eq("status", "SUCCESS")
    .gte("created_at", new Date(from).toISOString())
    .lt("created_at", new Date(to).toISOString())
    .limit(ROW_CAP);
  if (error) {
    console.error("analytics: window query failed", error.message);
    return NextResponse.json({ error: "Could not load analytics." }, { status: 500 });
  }

  const rows: Row[] = (data ?? []).map((o) => ({
    name: o.customer_name || "Anonymous",
    thbMinor: thbMinorOf(o),
    created: new Date(o.created_at).getTime(),
    currency: o.currency,
    amountMinor: o.amount_minor,
  }));

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const gross = rows.reduce((a, r) => a + r.thbMinor, 0);
  const count = rows.length;

  const byName = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const cur = byName.get(r.name) ?? { total: 0, count: 0 };
    cur.total += r.thbMinor;
    cur.count += 1;
    byName.set(r.name, cur);
  }
  const uniquePeople = byName.size;
  const repeaters = [...byName.values()].filter((v) => v.count >= 2).length;
  const repeatRate = uniquePeople > 0 ? Math.round((repeaters / uniquePeople) * 100) : 0;

  const avg = count > 0 ? Math.round(gross / count) : 0;

  const sorted = rows.map((r) => r.thbMinor).sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  let biggest = { amountMinor: 0, who: "", at: 0 };
  for (const r of rows) {
    if (r.thbMinor > biggest.amountMinor) biggest = { amountMinor: r.thbMinor, who: r.name, at: r.created };
  }

  // Delta vs. the previous comparable window (month/year only).
  let deltaPct: number | null = null;
  if (prevFrom != null && prevTo != null) {
    const { data: prevData, error: prevError } = await supabase
      .from("orders")
      .select("amount_minor, currency, thb_equivalent_minor")
      .eq("status", "SUCCESS")
      .gte("created_at", new Date(prevFrom).toISOString())
      .lt("created_at", new Date(prevTo).toISOString())
      .limit(ROW_CAP);
    if (!prevError) {
      const prevGross = (prevData ?? []).reduce((a, o) => a + thbMinorOf(o), 0);
      deltaPct = prevGross > 0 ? Math.round(((gross - prevGross) / prevGross) * 100) : null;
    }
  }

  // Sort a bucket's per-currency totals into the fixed display order.
  function sortCurrencies(m: Map<string, number>): { currency: string; amountMinor: number }[] {
    return CURRENCY_ORDER.filter((c) => m.has(c)).map((c) => ({ currency: c, amountMinor: m.get(c)! }));
  }

  // ── Chart buckets (value + tip count + per-currency breakdown, for the hover
  // tooltip — the breakdown is what lets the tooltip list "$1, ฿2,000, ¥100"
  // instead of a single approximate THB figure) ────────────────────────────────
  const chart: { label: string; valueMinor: number; count: number; currencies: { currency: string; amountMinor: number }[] }[] = [];
  if (bucket === "day") {
    const n = daysInMonth(y, m);
    const totals = new Array(n).fill(0) as number[];
    const counts = new Array(n).fill(0) as number[];
    const byCurrency: Map<string, number>[] = Array.from({ length: n }, () => new Map());
    for (const r of rows) {
      const day = new Date(r.created).getUTCDate();
      if (day >= 1 && day <= n) {
        totals[day - 1] += r.thbMinor;
        counts[day - 1] += 1;
        const m = byCurrency[day - 1];
        m.set(r.currency, (m.get(r.currency) ?? 0) + r.amountMinor);
      }
    }
    for (let d = 0; d < n; d++) {
      chart.push({ label: String(d + 1), valueMinor: totals[d], count: counts[d], currencies: sortCurrencies(byCurrency[d]) });
    }
  } else {
    // Month buckets from the window start to its last month.
    const startY = new Date(from).getUTCFullYear();
    const startM = new Date(from).getUTCMonth();
    const endDate = new Date(Math.min(to, now.getTime()) - 1);
    const endY = endDate.getUTCFullYear();
    const endM = endDate.getUTCMonth();
    const totals = new Map<string, number>();
    const counts = new Map<string, number>();
    const byCurrency = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const d = new Date(r.created);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      totals.set(key, (totals.get(key) ?? 0) + r.thbMinor);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const m = byCurrency.get(key) ?? new Map<string, number>();
      m.set(r.currency, (m.get(r.currency) ?? 0) + r.amountMinor);
      byCurrency.set(key, m);
    }
    let cy = startY;
    let cm = startM;
    while (cy < endY || (cy === endY && cm <= endM)) {
      const key = `${cy}-${cm}`;
      chart.push({ label: key, valueMinor: totals.get(key) ?? 0, count: counts.get(key) ?? 0, currencies: sortCurrencies(byCurrency.get(key) ?? new Map()) });
      cm += 1;
      if (cm > 11) {
        cm = 0;
        cy += 1;
      }
    }
  }

  // ── Top supporters (Anonymous never ranks — see isAnon) ─────────────────────
  const topSupporters = [...byName.entries()]
    .filter(([name]) => !isAnon(name))
    .map(([name, v]) => ({ name, amountMinor: v.total, count: v.count }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5);

  return NextResponse.json({
    range,
    anchor: { y, m },
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    earliest,
    bucket,
    kpis: {
      grossMinor: gross,
      count,
      uniquePeople,
      avgMinor: avg,
      medianMinor: median,
      biggestMinor: biggest.amountMinor,
      biggestWho: biggest.who,
      biggestAt: biggest.at ? new Date(biggest.at).toISOString() : null,
      repeatRate,
      deltaPct,
    },
    chart,
    topSupporters,
  });
}
