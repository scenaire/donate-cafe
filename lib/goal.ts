// SERVER ONLY. Single source of truth for "what is the active goal doing
// right now" — computed once here and projected by every consumer (/api/goal,
// /api/summary, the goal-bar overlay's REST endpoint and its realtime
// broadcast) instead of each maintaining its own copy of the sum + ending
// logic. Before this, /api/goal had the raise/hold/hide auto-ending logic and
// /api/summary didn't, which was a real (if low-stakes) inconsistency between
// the tip page and the OBS goal-bar overlay's numbers.
//
// Ending behavior is applied lazily, right here, the same reconciliation
// pattern /api/check-status uses for Stripe: the first read after raised
// crosses target does the reset/deactivate write, so it takes effect the
// moment ANY caller (a page load, a poll, a broadcast after a tip) touches
// this — no cron needed for something this low-stakes.

import { supabase } from "./supabase";
import { isCurrency, toMinorUnits, type Currency } from "./money";
import { fetchWishlistGoal } from "./bridge";

export type GoalEnding = "raise" | "hold" | "hide";
export type GoalKind = "local" | "wishlist";

export type GoalSummary = {
  label: string;
  currency: Currency;
  targetMinor: number;
  raisedMinor: number;
  progress: number; // 0..1 for a local goal (clamped); UNCLAMPED for wishlist
  kind: GoalKind;
  deadline: string | null;
  ending: GoalEnding;
  showOnCounter: boolean;
  showOnOverlay: boolean;
  showOnShare: boolean;
};

export async function computeGoalSummary(): Promise<GoalSummary | null> {
  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("id, label, target_minor, currency, kind, starts_at, deadline, ending, show_on_counter, show_on_overlay, show_on_share")
    .eq("is_active", true)
    .maybeSingle();

  if (goalError) {
    console.error("Failed to load goal", goalError.message);
    return null;
  }
  if (!goal) return null;

  // Wishlist-tracking goal: the wishlist DB is the sole ledger, so read its
  // /api/goal instead of summing local orders. Progress is deliberately NOT
  // clamped — an item carried past 100% by tips reads past 100% (PLAN §6). The
  // raise/hold/hide auto-ending below is skipped: the wishlist owns lifecycle.
  if (goal.kind === "wishlist") {
    const wl = await fetchWishlistGoal();
    if (!wl) return null;
    return {
      label: wl.label || (goal.label as string),
      currency: "thb",
      targetMinor: toMinorUnits(wl.targetThb, "thb"),
      raisedMinor: toMinorUnits(wl.raisedThb, "thb"),
      progress: Number.isFinite(wl.progress) ? wl.progress : 0,
      kind: "wishlist",
      deadline: null,
      ending: "hold",
      showOnCounter: goal.show_on_counter as boolean,
      showOnOverlay: goal.show_on_overlay as boolean,
      showOnShare: goal.show_on_share as boolean,
    };
  }

  if (!isCurrency(goal.currency)) return null;

  const currency = goal.currency as Currency;
  const { data, error } = await supabase.rpc("sum_succeeded_orders_since", { since_ts: goal.starts_at });
  if (error) {
    console.error("Failed to sum orders for goal", error.message);
    return null;
  }

  let raisedMinor = 0;
  for (const row of (data ?? []) as { currency: string; amount_minor: number }[]) {
    if (row.currency === currency) raisedMinor = Number(row.amount_minor);
  }

  const ending = (goal.ending as GoalEnding) ?? "hold";
  if (raisedMinor >= goal.target_minor) {
    if (ending === "raise") {
      const { error: resetError } = await supabase.from("goals").update({ starts_at: new Date().toISOString() }).eq("id", goal.id);
      if (resetError) console.error("Failed to reset goal for next jar", resetError.message);
      else raisedMinor = 0; // fresh window starts empty
    } else if (ending === "hide") {
      const { error: hideError } = await supabase.from("goals").update({ is_active: false }).eq("id", goal.id);
      if (hideError) console.error("Failed to auto-hide filled goal", hideError.message);
      else return null;
    }
    // "hold": no action — raisedMinor stays as computed, progress clamps below.
  }

  return {
    label: goal.label as string,
    currency,
    targetMinor: goal.target_minor as number,
    raisedMinor,
    progress: Math.min(1, goal.target_minor > 0 ? raisedMinor / goal.target_minor : 0),
    kind: "local",
    deadline: goal.deadline as string | null,
    ending,
    showOnCounter: goal.show_on_counter as boolean,
    showOnOverlay: goal.show_on_overlay as boolean,
    showOnShare: goal.show_on_share as boolean,
  };
}
