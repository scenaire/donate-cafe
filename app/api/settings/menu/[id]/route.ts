import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { parseMenuItemInput } from "../route";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = parseMenuItemInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabase
    .from("menu_items")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to update menu item", id, error.message);
    return NextResponse.json({ error: "Could not update menu item." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Menu item not found." }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const { error } = await supabase.from("menu_items").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete menu item", id, error.message);
    return NextResponse.json({ error: "Could not delete menu item." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
