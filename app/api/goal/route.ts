import { NextResponse } from "next/server";
import { fromMinorUnits } from "@/lib/money";
import { computeGoalSummary } from "@/lib/goal";

// PUBLIC goal progress for the tip page's café-goal card, receipt "goal after
// your tip" bar, and share-story goal line.
//
// This mirrors /api/summary's goal computation but WITHOUT the widget-token
// gate — summary is token-gated so a goal bar can be its own OBS source, but the
// unauthenticated tip page needs the same numbers. Only the goal label, target
// and raised total are exposed (no per-order data), and the goal is public by
// design (it's shown to every visitor).
//
// Returns THB major units. A goal counts only tips in its own currency (same
// reasoning as summary): converting a foreign tip into a THB goal would need an
// FX rate this endpoint has no business inventing. With THB-only charging every
// tip is THB anyway.
//
// Ending behavior ("when the jar fills") lives in lib/goal.ts's
// computeGoalSummary(), applied lazily the same way /api/check-status
// reconciles Stripe — the first read after raised crosses target does the
// reset/deactivate write. Every consumer of the goal (this route, /api/summary,
// the goal-bar overlay) shares that one implementation now.

const CACHE_SECONDS = 30;
const CACHE_HEADERS = {
  "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
};

export async function GET() {
  const summary = await computeGoalSummary();

  // No active goal: the tip page falls back to its static default.
  if (!summary) {
    return NextResponse.json({ goal: null }, { headers: CACHE_HEADERS });
  }

  return NextResponse.json(
    {
      goal: {
        label: summary.label,
        kind: summary.kind,
        targetThb: fromMinorUnits(summary.targetMinor, summary.currency),
        raisedThb: fromMinorUnits(summary.raisedMinor, summary.currency),
        deadline: summary.deadline,
        showOnCounter: summary.showOnCounter,
        showOnShare: summary.showOnShare,
      },
    },
    { headers: CACHE_HEADERS }
  );
}
