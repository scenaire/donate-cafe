import { beforeEach, describe, expect, it, vi } from "vitest";

type GoalRow = {
  id: string;
  label: string;
  target_minor: number;
  currency: string;
  is_active: boolean;
  starts_at: string;
  deadline: string | null;
  ending: string;
  show_on_counter: boolean;
  show_on_overlay: boolean;
  show_on_share: boolean;
};

let currentGoal: GoalRow | null = null;
const inserts = vi.fn();
const updates = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  requireAdmin: async () => ({ ok: true, email: "admin@example.com" }),
}));

vi.mock("@/lib/realtime", () => ({ publishGoalUpdate: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const selectQuery = {
        order: () => selectQuery,
        limit: () => selectQuery,
        maybeSingle: async () => ({ data: currentGoal, error: null }),
      };
      return {
        select: () => selectQuery,
        update: (fields: unknown) => {
          updates(fields);
          return { eq: () => ({ neq: async () => ({ error: null }) }) };
        },
        insert: async (fields: unknown) => {
          inserts(fields);
          return { error: null };
        },
      };
    },
  },
}));

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const response = await PUT(new Request("http://localhost/api/settings/goal", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
  return response;
}

beforeEach(() => {
  currentGoal = {
    id: "ended-goal", label: "Old goal", target_minor: 10_000, currency: "thb",
    is_active: false, starts_at: "2026-08-01T00:00:00Z", deadline: null, ending: "hold",
    show_on_counter: true, show_on_overlay: false, show_on_share: true,
  };
  inserts.mockReset();
  updates.mockReset();
});

describe("PUT /api/settings/goal", () => {
  it("creates a fresh goal instead of reviving the ended one when startNew is requested", async () => {
    const response = await put({
      label: "New camera", targetThb: 500, currency: "thb", active: true, startNew: true,
    });

    expect(response.status).toBe(200);
    expect(inserts).toHaveBeenCalledWith(expect.objectContaining({
      label: "New camera", is_active: true,
    }));
    expect(updates).not.toHaveBeenCalledWith(expect.objectContaining({ label: "New camera" }));
  });
});
