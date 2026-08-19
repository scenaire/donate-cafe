import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { stripHtml, clampString } from "@/lib/validate";
import { isCurrency, toMinorUnits, fromMinorUnits, type Currency } from "@/lib/money";
import { publishGoalUpdate } from "@/lib/realtime";

// Session-gated read/write for the single café goal. The tip page's own
// public /api/goal stays as-is (it only ever reads the active row); this is
// where Settings creates/edits it.
//
// The goals table enforces at most one is_active=true row via
// goals_single_active_idx. Phase 1 treats "the goal" as a single record the
// creator manages over time: editing in place preserves starts_at (so
// progress keeps counting from when it actually started); there is
// deliberately no UI here for running multiple goals in parallel.

const TARGET_MIN_THB = 20;
const TARGET_MAX_THB = 70_000;
const ENDINGS = ["raise", "hold", "hide"] as const;
type Ending = (typeof ENDINGS)[number];

async function currentGoal() {
  return supabase
    .from("goals")
    .select("id, label, target_minor, currency, is_active, starts_at, deadline, ending, show_on_counter, show_on_overlay, show_on_share")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await currentGoal();
  if (error) {
    console.error("Failed to load goal for settings", error.message);
    return NextResponse.json({ error: "Could not fetch goal." }, { status: 500 });
  }
  if (!data || !isCurrency(data.currency)) {
    return NextResponse.json({ goal: null });
  }

  const currency = data.currency as Currency;
  return NextResponse.json({
    goal: {
      id: data.id,
      label: data.label,
      targetThb: fromMinorUnits(data.target_minor, currency),
      currency,
      isActive: data.is_active,
      deadline: data.deadline as string | null,
      ending: data.ending as Ending,
      showOnCounter: data.show_on_counter as boolean,
      showOnOverlay: data.show_on_overlay as boolean,
      showOnShare: data.show_on_share as boolean,
    },
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const label = clampString(stripHtml(typeof b.label === "string" ? b.label : ""), 80).trim();
  if (!label) return NextResponse.json({ error: "Goal label is required." }, { status: 400 });

  const currency: Currency = isCurrency(b.currency) ? b.currency : "thb";
  const targetNum = Number(b.targetThb);
  if (!Number.isFinite(targetNum) || targetNum < TARGET_MIN_THB || targetNum > TARGET_MAX_THB) {
    return NextResponse.json({ error: `Target must be between ฿${TARGET_MIN_THB} and ฿${TARGET_MAX_THB.toLocaleString()}.` }, { status: 400 });
  }
  const target_minor = toMinorUnits(targetNum, currency);
  const active = b.active !== false;

  // YYYY-MM-DD or empty/absent → no deadline.
  const rawDeadline = typeof b.deadline === "string" ? b.deadline.trim() : "";
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(rawDeadline) ? rawDeadline : null;

  const ending: Ending = (ENDINGS as readonly string[]).includes(b.ending as string) ? (b.ending as Ending) : "hold";
  const show_on_counter = b.showOnCounter !== false;
  const show_on_overlay = b.showOnOverlay === true;
  const show_on_share = b.showOnShare !== false;

  const { data: existing, error: fetchError } = await currentGoal();
  if (fetchError) {
    console.error("Failed to load goal before save", fetchError.message);
    return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
  }

  if (active) {
    // Guard against an orphaned active row from outside this flow.
    const { error: deactivateError } = existing
      ? await supabase.from("goals").update({ is_active: false }).eq("is_active", true).neq("id", existing.id)
      : await supabase.from("goals").update({ is_active: false }).eq("is_active", true);
    if (deactivateError) {
      console.error("Failed to clear previous active goal", deactivateError.message);
      return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
    }
  }

  const fields = { label, target_minor, currency, is_active: active, deadline, ending, show_on_counter, show_on_overlay, show_on_share };

  if (existing) {
    const { error } = await supabase.from("goals").update(fields).eq("id", existing.id);
    if (error) {
      console.error("Failed to update goal", error.message);
      return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("goals").insert(fields);
    if (error) {
      console.error("Failed to create goal", error.message);
      return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
    }
  }

  // Best-effort — a streamer editing the target/label while live shouldn't
  // have to wait for the overlay's next reconciliation poll to see it update.
  void publishGoalUpdate();

  return NextResponse.json({ ok: true });
}
