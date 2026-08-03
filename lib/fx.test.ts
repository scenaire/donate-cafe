import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the ./supabase mock factory below can reach it — each test swaps
// this out to simulate a healthy read, a PostgREST error, or an outright throw.
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  supabase: {
    get from() {
      // A getter, because lib/supabase.ts exports a lazy Proxy that throws on
      // PROPERTY ACCESS (not on call) when the env vars are missing. Modelling
      // it as a plain function would miss exactly the failure this guards.
      return fromMock();
    },
  },
}));

// Only the constant is bound here; every test re-imports the module itself so
// fx.ts's 60s in-memory rate cache starts empty each time.
const { SEED_THB_PER_UNIT } = await import("./fx");

function healthyRead(rows: { currency: string; thb_per_unit: number }[]) {
  return () => () => ({ select: () => Promise.resolve({ data: rows, error: null }) });
}

describe("snapshotThb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fx.ts keeps a 60s module-level rate cache; reset it between tests so one
    // case's rates can't satisfy the next one's read.
    vi.resetModules();
  });

  it("short-circuits THB without touching the database at all", async () => {
    fromMock.mockImplementation(() => {
      throw new Error("should never be reached for THB");
    });

    const { snapshotThb: fresh } = await import("./fx");
    expect(await fresh(10000, "thb")).toEqual({
      thbEquivalentMinor: 10000,
      fxRateToThb: 1,
      fxSource: "identity",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("converts JPY through major units rather than assuming two decimals", async () => {
    fromMock.mockImplementation(healthyRead([{ currency: "jpy", thb_per_unit: 0.2 }]));

    const { snapshotThb: fresh } = await import("./fx");
    // ¥3000 is 3000 minor units (zero-decimal), × 0.2 = 600 THB = 60000 satang.
    // A hardcoded ÷100 anywhere in the chain would yield 600 here.
    expect(await fresh(3000, "jpy")).toEqual({
      thbEquivalentMinor: 60000,
      fxRateToThb: 0.2,
      fxSource: "cache",
    });
  });

  it("falls back to the seed rate when a currency has no stored row", async () => {
    fromMock.mockImplementation(healthyRead([{ currency: "usd", thb_per_unit: 35 }]));

    const { snapshotThb: fresh } = await import("./fx");
    const snap = await fresh(1000, "eur");
    expect(snap.fxRateToThb).toBe(SEED_THB_PER_UNIT.eur);
    expect(snap.fxSource).toBe("seed");
  });

  it("falls back to the seed rate when the read returns a PostgREST error", async () => {
    fromMock.mockImplementation(() => () => ({
      select: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    }));

    const { snapshotThb: fresh } = await import("./fx");
    const snap = await fresh(1000, "usd");
    expect(snap.fxRateToThb).toBe(SEED_THB_PER_UNIT.usd);
    expect(snap.fxSource).toBe("seed");
  });

  // The regression that matters. snapshotThb is awaited alongside the Stripe
  // call in /api/create-payment-intent, and the PromptPay branch confirms the
  // intent server-side — so a rejection here would 500 the request after money
  // could already have moved, and recordOrder would never write the row.
  it("NEVER rejects when the supabase client itself throws", async () => {
    fromMock.mockImplementation(() => {
      throw new Error("Missing SUPABASE_URL environment variable");
    });

    const { snapshotThb: fresh } = await import("./fx");
    const snap = await fresh(1000, "usd");
    expect(snap.fxRateToThb).toBe(SEED_THB_PER_UNIT.usd);
    expect(snap.fxSource).toBe("seed");
    expect(snap.thbEquivalentMinor).toBeGreaterThan(0);
  });

  it("NEVER rejects when the read rejects at the transport layer", async () => {
    fromMock.mockImplementation(() => () => ({
      select: () => Promise.reject(new Error("fetch failed")),
    }));

    const { snapshotThb: fresh } = await import("./fx");
    await expect(fresh(1000, "jpy")).resolves.toMatchObject({ fxSource: "seed" });
  });
});
