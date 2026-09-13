// The feed's contract, in three parts: EXPIRED never reaches the wire, the
// channel token is returned only to an admin, and the auth check is raced
// against the query without ever leaking rows to a caller that fails it.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Auth = Awaited<ReturnType<typeof import("@/lib/supabase-server").requireAdmin>>;
const requireAdmin = vi.fn(async (): Promise<Auth> => ({ ok: true, email: "admin@example.com" }));
vi.mock("@/lib/supabase-server", () => ({ requireAdmin: () => requireAdmin() }));

vi.mock("@/lib/live", async (importOriginal) => {
  // Keep the real livePayloadFromOrder — it's the mapping under test — but stub
  // the token read, which would otherwise hit the network.
  const actual = await importOriginal<typeof import("@/lib/live")>();
  return { ...actual, getLiveToken: async () => "tok_abc" };
});

type Row = Record<string, unknown> & { status: string; created_at: string };

const ROWS: Row[] = [
  { payment_intent_id: "pi_ok", status: "SUCCESS", created_at: "2026-08-20T10:00:00.000Z" },
  { payment_intent_id: "pi_held", status: "SUCCESS", moderation_status: "held", created_at: "2026-08-20T09:00:00.000Z" },
  { payment_intent_id: "pi_pending", status: "PENDING", created_at: "2026-08-20T08:00:00.000Z" },
  { payment_intent_id: "pi_failed", status: "FAILED", created_at: "2026-08-20T07:00:00.000Z" },
  { payment_intent_id: "pi_expired", status: "EXPIRED", created_at: "2026-08-20T06:00:00.000Z" },
];

function base(r: Row) {
  return {
    customer_name: "Someone", message: null, amount_minor: 100, currency: "thb",
    show_on_screen: true, alert_played_at: null, moderation_status: "approved",
    item_th: null, item_en: null, item_photo_url: null, ...r,
  };
}

function makeQuery() {
  const preds: ((r: Row) => boolean)[] = [];
  let lim = Infinity;
  const q = {
    select() { return q; },
    neq(col: string, val: unknown) { preds.push((r) => r[col] !== val); return q; },
    order() { return q; },
    limit(n: number) { lim = n; return q; },
    then(res: (v: { data: unknown[]; error: null }) => void, rej: (e: unknown) => void) {
      const out = ROWS.filter((r) => preds.every((p) => p(r))).map(base);
      return Promise.resolve({ data: out.slice(0, lim), error: null }).then(res, rej);
    },
  };
  return q;
}

vi.mock("@/lib/supabase", () => ({ supabase: { from: () => makeQuery() } }));

async function callRoute() {
  const { GET } = await import("@/app/api/live/feed/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

describe("GET /api/live/feed", () => {
  beforeEach(() => {
    requireAdmin.mockClear();
    requireAdmin.mockImplementation(async () => ({ ok: true, email: "admin@example.com" }));
  });

  it("excludes EXPIRED — an unpaid QR is noise on a glanceable feed", async () => {
    const { status, body } = await callRoute();
    expect(status).toBe(200);
    const ids = body.orders.map((o: { id: string }) => o.id);
    expect(ids).not.toContain("pi_expired");
  });

  it("still carries the states the overlay refuses — held, hidden, pending, failed", async () => {
    const { body } = await callRoute();
    const ids = body.orders.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["pi_ok", "pi_held", "pi_pending", "pi_failed"]));
  });

  it("returns the channel token in the body for an admin", async () => {
    const { body } = await callRoute();
    expect(body.token).toBe("tok_abc");
  });

  it("leaks neither token nor rows when the caller is not the admin", async () => {
    requireAdmin.mockImplementationOnce(async () => ({
      ok: false as const,
      response: new (await import("next/server")).NextResponse(JSON.stringify({ error: "Unauthorized." }), { status: 401 }),
    }));
    const { status, body } = await callRoute();
    expect(status).toBe(401);
    expect(body.token).toBeUndefined();
    expect(body.orders).toBeUndefined();
  });
});
