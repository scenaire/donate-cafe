import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrderRow } from "./supabase";
import { ALERT_EVENT, channelName } from "./realtime.shared";

// publishAlert is the delivery-side fail-closed gate: orders.test.ts proves the
// state machine CALLS it at the right moments; this proves that even when
// called, it refuses to broadcast a tip that is hidden, held, or blocked — the
// last line of defence for the moderation queue and the show_on_screen toggle.
//
// The channel name embeds the widget token (that's the whole auth model), so a
// missing token must also suppress the broadcast rather than send on a
// predictable channel.

// httpSend(event, payload) — the explicit REST form that replaced send()'s
// implicit fallback. It resolves {success:true} on a 202 and REJECTS on anything
// else, so "never throws" is proven by rejecting it, not by resolving a failure.

const { getWidgetToken, sendSpy, channelSpy } = vi.hoisted(() => {
  const sendSpy = vi.fn<(event: string, payload: unknown) => Promise<{ success: true }>>(
    () => Promise.resolve({ success: true as const })
  );
  return {
    getWidgetToken: vi.fn(() => Promise.resolve<string | null>("tok")),
    sendSpy,
    channelSpy: vi.fn(() => ({ httpSend: sendSpy })),
  };
});

vi.mock("./widget-token", () => ({ getWidgetToken }));
vi.mock("./supabase", () => ({ supabase: { channel: channelSpy } }));
vi.mock("./goal", () => ({ computeGoalSummary: vi.fn(() => Promise.resolve(null)) }));

import { publishAlert } from "./realtime";

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

beforeEach(() => {
  sendSpy.mockClear();
  channelSpy.mockClear();
  getWidgetToken.mockReset();
  getWidgetToken.mockResolvedValue("tok");
});

describe("publishAlert — broadcasts an approved, visible tip", () => {
  it("sends the alert on the token's channel with the mapped payload", async () => {
    const order = orderRow();
    await publishAlert(order);
    expect(channelSpy).toHaveBeenCalledWith(channelName("tok"));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [event, payload] = sendSpy.mock.calls[0] as [string, { name: string }];
    expect(event).toBe(ALERT_EVENT);
    expect(payload.name).toBe("Alice");
  });

  it("marks the payload as a replay when asked", async () => {
    await publishAlert(orderRow(), { replay: true });
    const [, payload] = sendSpy.mock.calls[0] as [string, { replay?: boolean }];
    expect(payload.replay).toBe(true);
  });
});

describe("publishAlert — fails closed", () => {
  it("does NOT broadcast a hidden tip (show_on_screen = false)", async () => {
    await publishAlert(orderRow({ show_on_screen: false }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does NOT broadcast a held tip", async () => {
    await publishAlert(orderRow({ moderation_status: "held" }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does NOT broadcast a blocked tip", async () => {
    await publishAlert(orderRow({ moderation_status: "blocked" }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when the widget token is unset", async () => {
    getWidgetToken.mockResolvedValue(null);
    await publishAlert(orderRow());
    expect(sendSpy).not.toHaveBeenCalled();
    expect(channelSpy).not.toHaveBeenCalled();
  });

  it("never throws when the broadcast rejects", async () => {
    // httpSend's real failure mode: it rejects rather than resolving a failure
    // shape, and a webhook must still return 2xx to Stripe for an event it has
    // already applied to the database.
    sendSpy.mockRejectedValueOnce(new Error("network"));
    await expect(publishAlert(orderRow())).resolves.toBeUndefined();
  });

  it("never throws when the broadcast resolves a failure shape", async () => {
    // The documented-but-currently-unused {success:false} branch. Locked so the
    // warn path stays total if a future supabase-js starts returning it.
    sendSpy.mockResolvedValueOnce({ success: false, status: 500, error: "boom" } as unknown as { success: true });
    await expect(publishAlert(orderRow())).resolves.toBeUndefined();
  });
});
