import { describe, it, expect } from "vitest";
import { clientKeyFromForwarded } from "./ratelimit";

describe("clientKeyFromForwarded", () => {
  it("takes the first hop out of a multi-IP X-Forwarded-For chain", () => {
    expect(clientKeyFromForwarded("203.0.113.1, 70.41.3.18, 150.172.238.178", "fallback")).toBe(
      "203.0.113.1"
    );
  });

  it("falls back when the header is null", () => {
    expect(clientKeyFromForwarded(null, "fallback-ip")).toBe("fallback-ip");
  });

  it("falls back when the header is an empty string", () => {
    expect(clientKeyFromForwarded("", "fallback-ip")).toBe("fallback-ip");
  });

  it("falls back when the header is whitespace-only", () => {
    expect(clientKeyFromForwarded("   ", "fallback-ip")).toBe("fallback-ip");
  });

  it("passes a single IP through unchanged", () => {
    expect(clientKeyFromForwarded("203.0.113.1", "fallback")).toBe("203.0.113.1");
  });

  it("trims leading and trailing whitespace around the first hop", () => {
    expect(clientKeyFromForwarded("   203.0.113.1   , 70.41.3.18", "fallback")).toBe("203.0.113.1");
  });
});
