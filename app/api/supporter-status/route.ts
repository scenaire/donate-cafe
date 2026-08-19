import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { clientKeyFromForwarded } from "@/lib/ratelimit";
import type { GuestTag } from "@/lib/cafe";

// PUBLIC: classifies a typed name into a GuestTag for Naire's conditioned
// idle lines (Voice panel). Approximate by design — guests aren't
// authenticated, this only matches on display name — same caveat as the
// Privacy panel's first-time-supporter check.
//
// Rate-limited per IP since it's an unauthenticated lookup endpoint called
// while someone types.

const RATE_MAX = 20;
const RATE_WINDOW_SECONDS = 60;
const AWAY_DAYS = 30;

export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!name || name.toLowerCase() === "anonymous") {
    return NextResponse.json({ tag: null });
  }

  const ip = clientKeyFromForwarded(req.headers.get("x-forwarded-for"), "unknown");
  const { data: allowed, error: rlError } = await supabase.rpc("try_consume_rate", {
    p_key: `supstat:${ip}`,
    p_max: RATE_MAX,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (rlError) {
    console.error("supporter-status rate-limit check failed", rlError.message);
  } else if (allowed === false) {
    return NextResponse.json({ tag: null }); // fail quiet — this only flavors dialogue
  }

  const pattern = name.replace(/[%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase
    .from("orders")
    .select("created_at")
    .eq("status", "SUCCESS")
    .ilike("customer_name", pattern)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("supporter-status lookup failed", error.message);
    return NextResponse.json({ tag: null });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ tag: "first" as GuestTag });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: topData } = await supabase.rpc("top_supporters_since", { since_ts: since, limit_n: 1 });
  const top = ((topData ?? []) as { display_name: string }[])[0];
  if (top && top.display_name.toLowerCase() === name.toLowerCase()) {
    return NextResponse.json({ tag: "top" as GuestTag });
  }

  const lastSeen = new Date(data[0].created_at as string).getTime();
  const awayCutoff = Date.now() - AWAY_DAYS * 24 * 60 * 60 * 1000;
  const tag: GuestTag = lastSeen < awayCutoff ? "away" : "returning";
  return NextResponse.json({ tag });
}
