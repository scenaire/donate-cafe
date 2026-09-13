// Written fresh — build step 12, the tip-goal bridge (PLAN.md §6, in the
// wishlist repo). In this arrangement donate-cafe is the READER and PUSHER:
// the wishlist database is the sole ledger. This module is the whole
// donate-cafe → wishlist surface — the goal pull (kind='wishlist') and the
// credit push on each succeeded tip. Both are best-effort by design: a bridge
// that is down must never fail a tip or a page load (§6 "Resilience"); it only
// lets the wishlist bar go stale.

import { supabase, type OrderRow } from "./supabase";

const GOAL_FETCH_TIMEOUT_MS = 2000; // §6: hard 2s timeout on the goal pull.
const CREDIT_PUSH_TIMEOUT_MS = 4000;

export type WishlistGoal = { label: string; targetThb: number; raisedThb: number; progress: number };

function bridgeConfig(): { baseUrl: string; secret: string } | null {
  const baseUrl = process.env.WISHLIST_SITE_URL;
  const secret = process.env.BRIDGE_SHARED_SECRET;
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

// Last-known-value fallback (§6 "Resilience"): the tip page takes money and
// must never fail because the wishlist is unreachable. A per-instance memory
// cache is enough — the degraded state is a stale bar, never a wrong one.
let lastKnownGoal: WishlistGoal | null = null;

export async function fetchWishlistGoal(): Promise<WishlistGoal | null> {
  const cfg = bridgeConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.baseUrl}/api/goal`, { signal: AbortSignal.timeout(GOAL_FETCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    if (!json?.goal) {
      // A resolved "no featured item" is authoritative — drop the stale value.
      lastKnownGoal = null;
      return null;
    }
    const g = json.goal;
    const goal: WishlistGoal = {
      label: typeof g.label === "string" ? g.label : "",
      targetThb: Number(g.targetThb),
      raisedThb: Number(g.raisedThb),
      progress: Number(g.progress),
    };
    if (!Number.isFinite(goal.targetThb) || goal.targetThb <= 0) return lastKnownGoal;
    lastKnownGoal = goal;
    return goal;
  } catch (err) {
    console.warn("fetchWishlistGoal: using last-known value", err instanceof Error ? err.message : err);
    return lastKnownGoal;
  }
}

// True only while the single active goal is a wishlist-tracking one, so we push
// credits ONLY when the wishlist is actually featuring an item — never on an
// ordinary café tip.
async function activeGoalIsWishlist(): Promise<boolean> {
  const { data, error } = await supabase.from("goals").select("kind").eq("is_active", true).maybeSingle();
  if (error) {
    console.error("activeGoalIsWishlist check failed", error.message);
    return false;
  }
  return data?.kind === "wishlist";
}

// Push a succeeded tip to the wishlist as a credit (§6 step 3 — speed).
// Fire-and-forget in spirit: never throws. The wishlist's reconciliation pull
// (§6 step 4 — correctness) repairs any push dropped here, so a failure costs
// latency, not accuracy.
export async function pushTipCredit(order: OrderRow): Promise<void> {
  const cfg = bridgeConfig();
  if (!cfg) return;
  if (!(await activeGoalIsWishlist())) return;

  // The wishlist ledger is THB-only. thb_equivalent_minor is the frozen FX
  // snapshot (lib/fx.ts); with THB-only charging it equals amount_minor. If it
  // is absent and the tip isn't THB, skip — the pull reconciles it once the FX
  // repair fills the snapshot in.
  const amountThbMinor = order.thb_equivalent_minor ?? (order.currency === "thb" ? order.amount_minor : null);
  if (!amountThbMinor || amountThbMinor <= 0) return;

  // Decision: show_on_screen=false → credited anonymously on the wishlist's
  // public GIFTED BY list too (a tipper who hid from the stream isn't named on
  // the other site).
  const isAnonymous = !order.show_on_screen;

  try {
    await fetch(`${cfg.baseUrl}/api/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify({
        paymentIntentId: order.payment_intent_id,
        amountThbMinor,
        originalAmountMinor: order.amount_minor,
        originalCurrency: order.currency,
        tipperName: isAnonymous ? null : order.customer_name,
        isAnonymous,
        occurredAt: order.created_at,
      }),
      signal: AbortSignal.timeout(CREDIT_PUSH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("pushTipCredit failed (sweep pull will reconcile)", order.payment_intent_id, err instanceof Error ? err.message : err);
  }
}
