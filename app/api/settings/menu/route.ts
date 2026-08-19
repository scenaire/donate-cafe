import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { stripHtml, clampString } from "@/lib/validate";

const MAX_TAILS = 6;
const MAX_TAIL_LEN = 200;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 24;

export function parseMenuItemInput(body: unknown): { ok: true; data: {
  th: string; en: string; price_thb: number; hidden: boolean; sort_order: number;
  tails: { th: string; en: string }[]; tags: string[]; thumb_url: string | null;
} } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const th = clampString(stripHtml(typeof b.th === "string" ? b.th : ""), 60).trim();
  const en = clampString(stripHtml(typeof b.en === "string" ? b.en : ""), 60).trim();
  if (!th || !en) return { ok: false, error: "Thai and English names are both required." };

  const priceNum = Number(b.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum > 100_000) {
    return { ok: false, error: "Price must be a positive amount." };
  }
  const price_thb = Math.round(priceNum);

  const hidden = b.hidden === true;
  const sortNum = Number(b.sortOrder);
  const sort_order = Number.isFinite(sortNum) ? Math.round(sortNum) : 0;

  const rawTails = Array.isArray(b.tails) ? b.tails : [];
  const tails = rawTails.slice(0, MAX_TAILS).map((t) => {
    const tt = (t ?? {}) as Record<string, unknown>;
    return {
      th: clampString(stripHtml(typeof tt.th === "string" ? tt.th : ""), MAX_TAIL_LEN).trim(),
      en: clampString(stripHtml(typeof tt.en === "string" ? tt.en : ""), MAX_TAIL_LEN).trim(),
    };
  }).filter((t) => t.th || t.en);

  const rawTags = Array.isArray(b.tags) ? b.tags : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of rawTags) {
    if (typeof t !== "string") continue;
    const tag = clampString(stripHtml(t), MAX_TAG_LEN).trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
      if (tags.length >= MAX_TAGS) break;
    }
  }

  // Only accept a same-origin Supabase Storage URL for the thumbnail; anything
  // else (or empty) clears it. Prevents an arbitrary URL being stored + rendered.
  let thumb_url: string | null = null;
  if (typeof b.thumbUrl === "string" && b.thumbUrl) {
    thumb_url = b.thumbUrl.includes("/storage/v1/object/public/cafe-assets/") ? b.thumbUrl : null;
  }

  return { ok: true, data: { th, en, price_thb, hidden, sort_order, tails, tags, thumb_url } };
}

// Session-gated: every menu item including hidden ones, for the editor list.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("menu_items")
    .select("id, th, en, price_thb, hidden, sort_order, tails, tags, thumb_url")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to list menu items", error.message);
    return NextResponse.json({ error: "Could not fetch menu items." }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = parseMenuItemInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabase.from("menu_items").insert(parsed.data).select().single();

  if (error) {
    console.error("Failed to create menu item", error.message);
    return NextResponse.json({ error: "Could not create menu item." }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}
