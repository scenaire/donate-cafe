import { describe, it, expect } from "vitest";
import { parseTxFilter, applyTxFilter, type TxFilter } from "./tx-filter";

// parseTxFilter guards an untrusted query-string value; applyTxFilter turns a
// filter into the exact WHERE clauses the transactions table + CSV export share.
// A regression here shows the wrong tips (or leaks private ones) in the owner's
// message panel, so the clause each mode emits is worth pinning precisely.

describe("parseTxFilter", () => {
  it.each(["all", "shown", "private", "queue", "pending"] as const)("passes through the valid value %s", (v) => {
    expect(parseTxFilter(v)).toBe(v);
  });

  it("defaults null and unknown values to 'all'", () => {
    expect(parseTxFilter(null)).toBe("all");
    expect(parseTxFilter("EXPIRED")).toBe("all");
    expect(parseTxFilter("' OR 1=1")).toBe("all");
  });
});

// A stand-in Supabase query builder that records the chained calls instead of
// hitting a database — each method returns the same object so the chain in
// applyTxFilter is preserved, exactly like the real PostgREST builder.
function spyBuilder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {} as Record<string, (...args: unknown[]) => typeof builder> & {
    __calls: typeof calls;
  };
  for (const m of ["eq", "neq", "is", "not"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.__calls = calls;
  return builder;
}

function clausesFor(filter: TxFilter) {
  const b = spyBuilder();
  const returned = applyTxFilter(b as never, filter);
  // applyTxFilter must hand back the same builder so the caller can keep chaining.
  expect(returned).toBe(b);
  return b.__calls;
}

describe("applyTxFilter — WHERE clauses per mode", () => {
  it("'all' excludes only EXPIRED", () => {
    expect(clausesFor("all")).toEqual([["neq", "status", "EXPIRED"]]);
  });

  it("'shown' = succeeded, on-screen, already played", () => {
    expect(clausesFor("shown")).toEqual([
      ["eq", "status", "SUCCESS"],
      ["eq", "show_on_screen", true],
      ["not", "alert_played_at", "is", null],
    ]);
  });

  it("'private' = off-screen and not expired", () => {
    expect(clausesFor("private")).toEqual([
      ["eq", "show_on_screen", false],
      ["neq", "status", "EXPIRED"],
    ]);
  });

  it("'queue' = succeeded, on-screen, not yet played", () => {
    expect(clausesFor("queue")).toEqual([
      ["eq", "status", "SUCCESS"],
      ["eq", "show_on_screen", true],
      ["is", "alert_played_at", null],
    ]);
  });

  it("'pending' = PENDING only", () => {
    expect(clausesFor("pending")).toEqual([["eq", "status", "PENDING"]]);
  });
});
