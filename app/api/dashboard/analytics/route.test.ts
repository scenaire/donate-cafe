// Guards the shape of this route as much as its numbers: the admin check and all
// three Supabase reads must stay concurrent (they gate the dashboard's first
// paint), and the "all" range must still cover every succeeded row even though it
// issues no lower bound.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Auth = Awaited<ReturnType<typeof import("@/lib/supabase-server").requireAdmin>>;
const requireAdmin = vi.fn(async (): Promise<Auth> => {
  await new Promise((r) => setTimeout(r, 30));
  return { ok: true, email: "admin@example.com" };
});
vi.mock("@/lib/supabase-server", () => ({ requireAdmin: () => requireAdmin() }));

// Fake orders table. Every terminal query resolves after a 30ms "network" delay,
// so wall-clock time reveals whether the route serialises its round trips.
type Row = {
  customer_name: string;
  amount_minor: number;
  currency: string;
  thb_equivalent_minor: number | null;
  created_at: string;
  status: string;
};

const ROWS: Row[] = [
  // previous month (2026-07)
  { customer_name: "Ann", amount_minor: 10000, currency: "thb", thb_equivalent_minor: 10000, created_at: "2026-07-05T00:00:00.000Z", status: "SUCCESS" },
  // current month (2026-08)
  { customer_name: "Ann", amount_minor: 20000, currency: "thb", thb_equivalent_minor: 20000, created_at: "2026-08-02T00:00:00.000Z", status: "SUCCESS" },
  { customer_name: "Ann", amount_minor: 5000, currency: "thb", thb_equivalent_minor: 5000, created_at: "2026-08-03T00:00:00.000Z", status: "SUCCESS" },
  { customer_name: "Bob", amount_minor: 300, currency: "usd", thb_equivalent_minor: 10500, created_at: "2026-08-09T00:00:00.000Z", status: "SUCCESS" },
  { customer_name: "Anonymous", amount_minor: 1000, currency: "thb", thb_equivalent_minor: 1000, created_at: "2026-08-11T00:00:00.000Z", status: "SUCCESS" },
  { customer_name: "Cid", amount_minor: 9999, currency: "thb", thb_equivalent_minor: 9999, created_at: "2026-08-12T00:00:00.000Z", status: "PENDING" },
];

let inflight = 0;
let maxInflight = 0;

function makeQuery() {
  const preds: ((r: Row) => boolean)[] = [];
  let asc: boolean | null = null;
  let lim = Infinity;

  const q = {
    select() { return q; },
    eq(col: keyof Row, val: unknown) { preds.push((r) => r[col] === val); return q; },
    gte(col: keyof Row, val: string) { preds.push((r) => String(r[col]) >= val); return q; },
    lt(col: keyof Row, val: string) { preds.push((r) => String(r[col]) < val); return q; },
    order(_c: string, o: { ascending: boolean }) { asc = o.ascending; return q; },
    limit(n: number) { lim = n; return q; },
    then(res: (v: { data: Row[]; error: null }) => void, rej: (e: unknown) => void) {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      return new Promise<{ data: Row[]; error: null }>((resolve) => {
        setTimeout(() => {
          inflight -= 1;
          let out = ROWS.filter((r) => preds.every((p) => p(r)));
          if (asc !== null) out = [...out].sort((a, b) => (a.created_at < b.created_at ? -1 : 1) * (asc ? 1 : -1));
          resolve({ data: out.slice(0, lim), error: null });
        }, 30);
      }).then(res, rej);
    },
  };
  return q;
}

vi.mock("@/lib/supabase", () => ({ supabase: { from: () => makeQuery() } }));

async function callRoute(url: string) {
  const { GET } = await import("@/app/api/dashboard/analytics/route");
  const req = { nextUrl: new URL(url) } as unknown as Parameters<typeof GET>[0];
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

describe("analytics route", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-08-20T00:00:00.000Z"));
    inflight = 0;
    maxInflight = 0;
    requireAdmin.mockClear();
  });

  it("month: KPIs, delta and chart are computed over the right windows", async () => {
    const { status, body } = await callRoute("http://x/api/dashboard/analytics?range=month&anchor=2026-8");
    expect(status).toBe(200);
    // SUCCESS rows in August: 20000 + 5000 + 10500 + 1000 = 36500 (PENDING excluded)
    expect(body.kpis.grossMinor).toBe(36500);
    expect(body.kpis.count).toBe(4);
    expect(body.kpis.uniquePeople).toBe(3); // Ann, Bob, Anonymous
    expect(body.kpis.biggestMinor).toBe(20000);
    // July gross 10000 -> (36500-10000)/10000 = 265%
    expect(body.kpis.deltaPct).toBe(265);
    expect(body.bucket).toBe("day");
    expect(body.chart).toHaveLength(31);
    expect(body.chart[1]).toMatchObject({ label: "2", valueMinor: 20000, count: 1 });
    // Anonymous never ranks
    expect(body.topSupporters.map((s: { name: string }) => s.name)).toEqual(["Ann", "Bob"]);
    expect(body.earliest).toBe("2026-07-05T00:00:00.000Z");
  });

  it("all: window starts at the earliest order and spans every succeeded row", async () => {
    const { status, body } = await callRoute("http://x/api/dashboard/analytics?range=all");
    expect(status).toBe(200);
    expect(body.kpis.grossMinor).toBe(46500); // July + August
    expect(body.kpis.count).toBe(5);
    expect(body.kpis.deltaPct).toBeNull();
    expect(body.from).toBe("2026-07-05T00:00:00.000Z");
    expect(body.bucket).toBe("month");
    expect(body.chart.map((c: { label: string }) => c.label)).toEqual(["2026-6", "2026-7"]);
  });

  it("year: rolls up into month buckets", async () => {
    const { body } = await callRoute("http://x/api/dashboard/analytics?range=year&anchor=2026");
    expect(body.kpis.grossMinor).toBe(46500);
    expect(body.bucket).toBe("month");
    expect(body.chart).toHaveLength(8); // Jan..Aug
  });

  it("runs the admin check and all queries concurrently, not in series", async () => {
    const t = Date.now();
    await callRoute("http://x/api/dashboard/analytics?range=month&anchor=2026-8");
    const elapsed = Date.now() - t;
    expect(maxInflight).toBeGreaterThanOrEqual(3); // earliest + window + prev overlap
    expect(elapsed).toBeLessThan(90); // 4 x 30ms serial would be ~120ms
  });

  it("returns the auth failure response and no data when not admin", async () => {
    requireAdmin.mockImplementationOnce(async () => ({
      ok: false as const,
      response: new (await import("next/server")).NextResponse(JSON.stringify({ error: "Unauthorized." }), { status: 401 }),
    }));
    const { status, body } = await callRoute("http://x/api/dashboard/analytics?range=month");
    expect(status).toBe(401);
    expect(body.kpis).toBeUndefined();
  });
});
