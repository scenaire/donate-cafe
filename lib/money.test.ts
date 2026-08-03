import { describe, it, expect } from "vitest";
import { toMinorUnits, fromMinorUnits, formatMoney, formatAmountValue, spokenAmount } from "./money";

describe("toMinorUnits / fromMinorUnits", () => {
  it("round-trips THB/USD/EUR at x100 (two-decimal currencies)", () => {
    for (const currency of ["thb", "usd", "eur"] as const) {
      expect(toMinorUnits(300, currency)).toBe(30000);
      expect(fromMinorUnits(30000, currency)).toBe(300);
      expect(toMinorUnits(19.99, currency)).toBe(1999);
      expect(fromMinorUnits(1999, currency)).toBe(19.99);
    }
  });

  it("round-trips JPY at x1 (zero-decimal currency)", () => {
    expect(toMinorUnits(500, "jpy")).toBe(500);
    expect(fromMinorUnits(500, "jpy")).toBe(500);
  });

  it("never multiplies JPY by 100", () => {
    // The one rule the whole file exists to enforce.
    expect(toMinorUnits(500, "jpy")).not.toBe(50000);
  });
});

describe("formatAmountValue", () => {
  it("strips a trailing .00", () => {
    expect(formatAmountValue(300, "thb")).toBe("300");
  });

  it("keeps meaningful decimals", () => {
    expect(formatAmountValue(222.22, "thb")).toBe("222.22");
  });

  it("groups thousands", () => {
    expect(formatAmountValue(30000, "thb")).toBe("30,000");
    expect(formatAmountValue(1234567, "jpy")).toBe("1,234,567");
  });
});

describe("formatMoney", () => {
  it("includes the currency symbol and formats from minor units", () => {
    expect(formatMoney(30000, "thb")).toBe("฿300");
    expect(formatMoney(300, "usd")).toBe("$3");
    expect(formatMoney(500, "jpy")).toBe("¥500");
  });
});

describe("spokenAmount", () => {
  it("appends the spoken unit word for the given language", () => {
    expect(spokenAmount(30000, "thb", "en")).toBe("300 baht");
    expect(spokenAmount(30000, "thb", "th")).toBe("300 บาท");
    expect(spokenAmount(300, "usd", "en")).toBe("3 dollars");
  });
});
