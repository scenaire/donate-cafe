import { describe, it, expect } from "vitest";
// Importing lib/supabase.ts here (rather than just re-exporting the pure
// function) is itself part of what's under test: the module's client is
// behind a lazy Proxy, so importing it and calling a pure export must not
// require any Supabase env vars at all.
import { statusFromStripe } from "./supabase";

describe("statusFromStripe", () => {
  it("maps succeeded to SUCCESS", () => {
    expect(statusFromStripe("succeeded")).toBe("SUCCESS");
  });

  it("maps processing to SUCCESS (PromptPay settlement case)", () => {
    expect(statusFromStripe("processing")).toBe("SUCCESS");
  });

  it("maps canceled to FAILED", () => {
    expect(statusFromStripe("canceled")).toBe("FAILED");
  });

  it("maps everything else to PENDING", () => {
    expect(statusFromStripe("requires_payment_method")).toBe("PENDING");
    expect(statusFromStripe("requires_action")).toBe("PENDING");
    expect(statusFromStripe("requires_confirmation")).toBe("PENDING");
    expect(statusFromStripe("something_unexpected")).toBe("PENDING");
  });
});
