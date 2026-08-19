import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PUBLIC menu for the tip page's treat grid. Only non-hidden items, in display
// order. This mirrors /api/goal and /api/cafe-config: unauthenticated because
// the tip page itself is unauthenticated, cached because it changes rarely.

const CACHE_SECONDS = 30;
const CACHE_HEADERS = {
  "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
};

export async function GET() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, th, en, price_thb, tails, tags, thumb_url")
    .eq("hidden", false)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load menu", error.message);
    return NextResponse.json({ error: "Could not fetch menu." }, { status: 500 });
  }

  const items = (data ?? []).map((row) => ({
    id: row.id as string,
    th: row.th as string,
    en: row.en as string,
    price: row.price_thb as number,
    tails: (row.tails ?? []) as { th: string; en: string }[],
    tags: (row.tags ?? []) as string[],
    thumbUrl: (row.thumb_url ?? null) as string | null,
  }));

  return NextResponse.json({ items }, { headers: CACHE_HEADERS });
}
