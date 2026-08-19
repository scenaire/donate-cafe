import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";

// Rotates the OBS widget token. Breaks every URL already pasted into OBS
// (alert overlay AND, once built, the goal bar overlay — they share this one
// token) until the new URL is copied in from Settings. Deliberately a
// separate route from the PUT above: this is a distinct, one-way action with
// its own confirmation in the UI, not a field you'd bundle into a normal save.
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const token = randomBytes(24).toString("base64url");

  const { error } = await supabase.from("cafe_settings").update({ widget_token: token }).eq("id", true);
  if (error) {
    console.error("Failed to regenerate widget token", error.message);
    return NextResponse.json({ error: "Could not regenerate the token." }, { status: 500 });
  }

  return NextResponse.json({ widgetToken: token });
}
