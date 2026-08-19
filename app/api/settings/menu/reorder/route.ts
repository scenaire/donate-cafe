import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";

// Session-gated bulk reorder / zone move for drag-and-drop on the Menu panel.
// The client sends the full desired ordering as it looks after a drag — each
// row's new sort_order and hidden flag (shelves = hidden:false, book =
// hidden:true). Persisted one UPDATE per row; the list is small (a café menu),
// so a per-row loop is fine and keeps each write scoped to its own id.

type Move = { id: string; sortOrder: number; hidden: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rawItems = (body as { items?: unknown })?.items;
  if (!Array.isArray(rawItems)) {
    return NextResponse.json({ error: "Expected an items array." }, { status: 400 });
  }

  const moves: Move[] = [];
  for (const it of rawItems) {
    const r = (it ?? {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || !UUID_RE.test(r.id)) {
      return NextResponse.json({ error: "Invalid item id." }, { status: 400 });
    }
    const sortNum = Number(r.sortOrder);
    moves.push({
      id: r.id,
      sortOrder: Number.isFinite(sortNum) ? Math.round(sortNum) : 0,
      hidden: r.hidden === true,
    });
  }

  for (const m of moves) {
    const { error } = await supabase
      .from("menu_items")
      .update({ sort_order: m.sortOrder, hidden: m.hidden })
      .eq("id", m.id);
    if (error) {
      console.error("Failed to reorder menu item", m.id, error.message);
      return NextResponse.json({ error: "Could not save the new order." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
