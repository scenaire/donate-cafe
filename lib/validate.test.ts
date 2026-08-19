import { describe, it, expect } from "vitest";
import { validateOrderInput } from "./validate";

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Naire",
    amount: 100,
    currency: "thb",
    method: "promptpay",
    message: "hi",
    showOnScreen: true,
    email: "a@b.com",
    ...overrides,
  };
}

describe("validateOrderInput — amount ranges", () => {
  it("rejects an amount below the currency minimum", () => {
    const result = validateOrderInput(baseBody({ amount: 1 })); // THB min is 20
    expect(result.ok).toBe(false);
  });

  it("rejects an amount above the currency maximum", () => {
    const result = validateOrderInput(baseBody({ amount: 999999 })); // THB max is 50000
    expect(result.ok).toBe(false);
  });

  it("accepts an amount within range", () => {
    const result = validateOrderInput(baseBody({ amount: 300 }));
    expect(result.ok).toBe(true);
  });

  it("enforces USD's own range independently of THB's", () => {
    // USD 5 is below THB's min (20) yet valid for USD — proves the range is
    // per-currency, not THB's floor applied everywhere.
    const result = validateOrderInput(
      baseBody({ currency: "usd", method: "card", amount: 5, email: "" })
    );
    expect(result.ok).toBe(true);
    // Below USD's own Stripe floor (0.50) is rejected. (0.50 itself is valid —
    // the server floor is Stripe's absolute minimum; the tip page enforces a
    // higher UX minimum. See CURRENCIES in lib/money.ts.)
    const tooLow = validateOrderInput(
      baseBody({ currency: "usd", method: "card", amount: 0.1, email: "" })
    );
    expect(tooLow.ok).toBe(false);
  });
});

describe("validateOrderInput — JPY whole-number rule", () => {
  it("rejects a fractional JPY amount", () => {
    const result = validateOrderInput(
      baseBody({ currency: "jpy", method: "card", amount: 100.5, email: "" })
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a whole-number JPY amount", () => {
    const result = validateOrderInput(
      baseBody({ currency: "jpy", method: "card", amount: 500, email: "" })
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateOrderInput — method/currency coupling", () => {
  it("keeps promptpay for THB when requested", () => {
    const result = validateOrderInput(baseBody({ currency: "thb", method: "promptpay" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.method).toBe("promptpay");
  });

  it("forces card for any non-THB currency, even if promptpay was requested", () => {
    const result = validateOrderInput(
      baseBody({ currency: "usd", method: "promptpay", amount: 5, email: "" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.method).toBe("card");
  });
});

describe("validateOrderInput — email requirement", () => {
  it("requires a valid email for promptpay", () => {
    const missing = validateOrderInput(baseBody({ email: "" }));
    expect(missing.ok).toBe(false);
    const invalid = validateOrderInput(baseBody({ email: "not-an-email" }));
    expect(invalid.ok).toBe(false);
  });

  it("does not require an email for card", () => {
    const result = validateOrderInput(
      baseBody({ currency: "usd", method: "card", amount: 5, email: "" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe("");
  });

  it("still validates an email for card if one is supplied", () => {
    const result = validateOrderInput(
      baseBody({ currency: "usd", method: "card", amount: 5, email: "not-an-email" })
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateOrderInput — sanitize & clamp (masking moved to lib/moderation)", () => {
  it("does NOT mask flagged words — that responsibility moved to the moderation pipeline", () => {
    // validateOrderInput only strips HTML and clamps length; content moderation
    // (masking/holding/blocking) now happens later in evaluateModeration. See
    // moderation.test.ts for masking coverage and validate.ts:32 for the note.
    const result = validateOrderInput(baseBody({ message: "you fuck are great" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBe("you fuck are great");
  });

  it("strips HTML tags from the message", () => {
    const result = validateOrderInput(baseBody({ message: "hi <b>there</b>" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBe("hi there");
  });

  it("clamps message length to 250", () => {
    const longMessage = "a".repeat(260);
    const result = validateOrderInput(baseBody({ message: longMessage }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message.length).toBe(250);
  });
});
