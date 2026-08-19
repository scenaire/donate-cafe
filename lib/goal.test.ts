import { describe, it, expect, vi, beforeEach } from "vitest";

// computeGoalSummary owns the goal's "what happens when the jar fills" rule,
// applied lazily on read: raise (reset for the next jar), hide (deactivate), or
// hold (cap at 100%). Getting this wrong resets a live counter or hides a goal
// early, so each ending is pinned here against a mocked client. The two writes
// (reset starts_at / deactivate) go through .update().eq(); the read path is
// .select().eq().maybeSingle() plus the sum RPC.
const { selectMaybeSingle, rpcFn, updateEq } = vi.hoisted(() => ({
  selectMaybeSingle: vi.fn(),
  rpcFn: vi.fn(),
  updateEq: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: selectMaybeSingle }) }),
      update: () => ({ eq: updateEq }),
    }),
    rpc: rpcFn,
  },
}));

import { computeGoalSummary } from "./goal";

type GoalRow = {
  id: string;
  label: string;
  target_minor: number;
  currency: string;
  starts_at: string;
  deadline: string | null;
  ending: "raise" | "hold" | "hide";
  show_on_counter: boolean;
  show_on_overlay: boolean;
  show_on_share: boolean;
};

function goalRow(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: "g1",
    label: "New espresso machine",
    target_minor: 100_000, // ฿1,000.00
    currency: "thb",
    starts_at: "2026-08-01T00:00:00Z",
    deadline: null,
    ending: "hold",
    show_on_counter: true,
    show_on_overlay: true,
    show_on_share: true,
    ...overrides,
  };
}

/** Wire the mocked client: the active goal row, then the per-currency sum rows. */
function setup(goal: GoalRow | null, sumRows: { currency: string; amount_minor: number }[]) {
  selectMaybeSingle.mockResolvedValue({ data: goal, error: null });
  rpcFn.mockResolvedValue({ data: sumRows, error: null });
}

beforeEach(() => {
  selectMaybeSingle.mockReset();
  rpcFn.mockReset();
  updateEq.mockReset();
  updateEq.mockResolvedValue({ error: null });
});

describe("computeGoalSummary — no active goal", () => {
  it("returns null when no goal row exists", async () => {
    setup(null, []);
    expect(await computeGoalSummary()).toBeNull();
  });

  it("returns null when the goal's currency is invalid", async () => {
    setup(goalRow({ currency: "xyz" }), []);
    expect(await computeGoalSummary()).toBeNull();
  });
});

describe("computeGoalSummary — below target", () => {
  it("reports raised/target/progress and writes nothing", async () => {
    setup(goalRow(), [{ currency: "thb", amount_minor: 25_000 }]);
    const s = await computeGoalSummary();
    expect(s).not.toBeNull();
    expect(s!.raisedMinor).toBe(25_000);
    expect(s!.targetMinor).toBe(100_000);
    expect(s!.progress).toBeCloseTo(0.25);
    expect(updateEq).not.toHaveBeenCalled();
  });

  it("counts only tips in the goal's own currency", async () => {
    setup(goalRow(), [
      { currency: "thb", amount_minor: 40_000 },
      { currency: "usd", amount_minor: 9_999 }, // ignored — not the goal currency
    ]);
    const s = await computeGoalSummary();
    expect(s!.raisedMinor).toBe(40_000);
  });
});

describe("computeGoalSummary — jar filled, per ending", () => {
  it("'hold' caps progress at 1 and keeps the raised total, writing nothing", async () => {
    setup(goalRow({ ending: "hold" }), [{ currency: "thb", amount_minor: 150_000 }]);
    const s = await computeGoalSummary();
    expect(s!.raisedMinor).toBe(150_000);
    expect(s!.progress).toBe(1);
    expect(updateEq).not.toHaveBeenCalled();
  });

  it("'raise' resets the window (raised back to 0) and writes once", async () => {
    setup(goalRow({ ending: "raise" }), [{ currency: "thb", amount_minor: 150_000 }]);
    const s = await computeGoalSummary();
    expect(s).not.toBeNull();
    expect(s!.raisedMinor).toBe(0);
    expect(s!.progress).toBe(0);
    expect(updateEq).toHaveBeenCalledTimes(1);
  });

  it("'hide' deactivates the goal and returns null", async () => {
    setup(goalRow({ ending: "hide" }), [{ currency: "thb", amount_minor: 150_000 }]);
    const s = await computeGoalSummary();
    expect(s).toBeNull();
    expect(updateEq).toHaveBeenCalledTimes(1);
  });
});
