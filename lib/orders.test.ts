import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrderRow } from "./supabase";

// The order state machine is where money becomes an on-stream alert. Every
// transition is a conditional UPDATE ... RETURNING, and the RETURNED row (or its
// absence) decides whether an alert fires. The two guarantees worth locking:
//
//   1. Exactly-once — a transition that didn't win the race (maybeSingle → null)
//      must NOT publish, or a replayed webhook double-announces a tip.
//   2. Moderation interplay — approving a still-PENDING held order must NOT
//      publish yet (the payment hasn't settled); approving an already-SUCCESS
//      one fires the alert publishAlert withheld the first time.
//
// supabase is mocked as a chainable, awaitable builder whose terminal resolves
// to whatever the test staged; publishAlert/publishGoalUpdate are spied so we
// assert precisely when the alert pipeline is (and isn't) triggered.

const { staged, publishAlert, publishGoalUpdate, publishLiveUpdate } = vi.hoisted(() => ({
  staged: { result: { data: null as unknown, error: null as unknown } },
  publishAlert: vi.fn(),
  publishGoalUpdate: vi.fn(),
  publishLiveUpdate: vi.fn(),
}));

vi.mock("./supabase", () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["update", "delete", "eq", "in", "lt", "select"]) builder[m] = chain;
  builder.maybeSingle = () => Promise.resolve(staged.result);
  // Awaitable terminal for the queries that end on .select() with no maybeSingle.
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(staged.result).then(res, rej);
  return { supabase: { from: () => builder } };
});

vi.mock("./realtime", () => ({ publishAlert, publishGoalUpdate }));
vi.mock("./live", () => ({ publishLiveUpdate }));

import {
  promoteToSuccess,
  forceSuccess,
  approveModerated,
  blockModerated,
  markFailed,
} from "./orders";

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o1",
    payment_intent_id: "pi_123",
    customer_name: "Alice",
    message: "great stream",
    amount_minor: 10_000,
    currency: "thb",
    show_on_screen: true,
    status: "SUCCESS",
    alert_played_at: null,
    reversed_at: null,
    thb_equivalent_minor: 10_000,
    fx_rate_to_thb: 1,
    fx_source: "identity",
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
    moderation_status: "approved",
    tts_ok: true,
    moderation_reason: null,
    moderation_word: null,
    item_th: null,
    item_en: null,
    item_photo_url: null,
    ...overrides,
  };
}

/** Stage what the conditional UPDATE ... RETURNING resolves to. */
function stage(data: unknown, error: unknown = null) {
  staged.result = { data, error };
}

beforeEach(() => {
  publishAlert.mockReset();
  publishGoalUpdate.mockReset();
  publishLiveUpdate.mockReset();
  stage(null);
});

describe("promoteToSuccess", () => {
  it("publishes the alert and a goal update when a row transitions", async () => {
    const row = orderRow({ status: "SUCCESS" });
    stage(row);
    const res = await promoteToSuccess("pi_123");
    expect(res).toEqual({ transitioned: true, order: row });
    expect(publishAlert).toHaveBeenCalledWith(row);
    expect(publishGoalUpdate).toHaveBeenCalledTimes(1);
  });

  it("does NOT publish when no row is returned (already final — no double announce)", async () => {
    stage(null);
    const res = await promoteToSuccess("pi_123");
    expect(res).toEqual({ transitioned: false, reason: "already_final" });
    expect(publishAlert).not.toHaveBeenCalled();
    expect(publishGoalUpdate).not.toHaveBeenCalled();
  });

  it("does NOT publish on a DB error", async () => {
    stage(null, { message: "boom" });
    const res = await promoteToSuccess("pi_123");
    expect(res).toEqual({ transitioned: false, reason: "not_found" });
    expect(publishAlert).not.toHaveBeenCalled();
  });
});

describe("forceSuccess (admin override)", () => {
  it("publishes when it forces a row to SUCCESS", async () => {
    const row = orderRow();
    stage(row);
    const res = await forceSuccess("pi_123");
    expect(res.transitioned).toBe(true);
    expect(publishAlert).toHaveBeenCalledWith(row);
    expect(publishGoalUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports not_found and publishes nothing when the order is missing", async () => {
    stage(null);
    const res = await forceSuccess("pi_123");
    expect(res).toEqual({ transitioned: false, reason: "not_found" });
    expect(publishAlert).not.toHaveBeenCalled();
  });
});

describe("approveModerated", () => {
  it("fires the withheld alert when the order has already succeeded", async () => {
    const row = orderRow({ status: "SUCCESS", moderation_status: "approved" });
    stage(row);
    const res = await approveModerated("pi_123");
    expect(res.transitioned).toBe(true);
    expect(publishAlert).toHaveBeenCalledWith(row);
  });

  it("does NOT publish yet when the approved order is still PENDING", async () => {
    // Payment hasn't settled — the alert must wait for promoteToSuccess, not
    // fire early off a moderation approval.
    const row = orderRow({ status: "PENDING", moderation_status: "approved" });
    stage(row);
    const res = await approveModerated("pi_123");
    expect(res.transitioned).toBe(true);
    expect(publishAlert).not.toHaveBeenCalled();
  });

  it("reports not_found (and publishes nothing) when nothing was held to approve", async () => {
    stage(null);
    const res = await approveModerated("pi_123");
    expect(res).toEqual({ transitioned: false, reason: "not_found" });
    expect(publishAlert).not.toHaveBeenCalled();
  });
});

describe("blockModerated / markFailed never announce", () => {
  it("blockModerated transitions without publishing", async () => {
    stage(orderRow({ moderation_status: "blocked" }));
    const res = await blockModerated("pi_123");
    expect(res.transitioned).toBe(true);
    expect(publishAlert).not.toHaveBeenCalled();
  });

  it("markFailed transitions a PENDING order without publishing", async () => {
    stage(orderRow({ status: "FAILED" }));
    const res = await markFailed("pi_123");
    expect(res.transitioned).toBe(true);
    expect(publishAlert).not.toHaveBeenCalled();
  });

  it("markFailed reports already_final when nothing moved", async () => {
    stage(null);
    const res = await markFailed("pi_123");
    expect(res).toEqual({ transitioned: false, reason: "already_final" });
  });
});

// The /live feed is the deliberate inverse of the alert pipeline: it exists so
// the creator sees what the overlay refuses. These lock that asymmetry, because
// the tempting "simplification" is to fold it into publishAlert's call sites —
// which would silently stop held and hidden tips reaching the one view built to
// show them.
describe("publishLiveUpdate (the /live feed)", () => {
  it("fires on a successful promotion, alongside the alert", async () => {
    const row = orderRow({ status: "SUCCESS" });
    stage(row);
    await promoteToSuccess("pi_123");
    expect(publishLiveUpdate).toHaveBeenCalledWith(row);
  });

  it("fires for a HIDDEN tip that the overlay never shows", async () => {
    const row = orderRow({ status: "SUCCESS", show_on_screen: false });
    stage(row);
    await promoteToSuccess("pi_123");
    expect(publishLiveUpdate).toHaveBeenCalledWith(row);
  });

  it("fires for a HELD tip whose alert is withheld pending a decision", async () => {
    const row = orderRow({ status: "SUCCESS", moderation_status: "held" });
    stage(row);
    await promoteToSuccess("pi_123");
    expect(publishLiveUpdate).toHaveBeenCalledWith(row);
  });

  it("fires on approval even when there is no alert to announce (still PENDING)", async () => {
    const row = orderRow({ status: "PENDING", moderation_status: "approved" });
    stage(row);
    await approveModerated("pi_123");
    expect(publishAlert).not.toHaveBeenCalled();
    expect(publishLiveUpdate).toHaveBeenCalledWith(row);
  });

  it("fires on block and on failure — states the overlay has no concept of", async () => {
    const blocked = orderRow({ moderation_status: "blocked" });
    stage(blocked);
    await blockModerated("pi_123");
    expect(publishLiveUpdate).toHaveBeenCalledWith(blocked);

    publishLiveUpdate.mockReset();
    const failed = orderRow({ status: "FAILED" });
    stage(failed);
    await markFailed("pi_123");
    expect(publishLiveUpdate).toHaveBeenCalledWith(failed);
  });

  it("does NOT fire when the transition lost its race — no duplicate feed rows", async () => {
    stage(null);
    await promoteToSuccess("pi_123");
    await markFailed("pi_123");
    await blockModerated("pi_123");
    expect(publishLiveUpdate).not.toHaveBeenCalled();
  });

  it("does NOT fire on a DB error", async () => {
    stage(null, { message: "boom" });
    await promoteToSuccess("pi_123");
    expect(publishLiveUpdate).not.toHaveBeenCalled();
  });
});
