import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";

// Session-gated: blocked orders from the last 7 days, grouped by what
// triggered the block (the matched word, or the reason when there's no
// single word — e.g. a name-only match). Counts only, no names/messages —
// this is a "here's what your filter has been doing" summary, not a log of
// who said what.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("moderation_word, moderation_reason")
    .eq("moderation_status", "blocked")
    .gte("created_at", since);

  if (error) {
    console.error("Failed to load moderation log", error.message);
    return NextResponse.json({ error: "Could not fetch the log." }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { moderation_word: string | null; moderation_reason: string | null }[]) {
    const key = row.moderation_word ? `"${row.moderation_word}"` : (row.moderation_reason ?? "flagged");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const log = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([what, count]) => ({ what, count }));

  return NextResponse.json({ log });
}
