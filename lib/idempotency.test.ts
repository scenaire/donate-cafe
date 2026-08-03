import { describe, it, expect } from "vitest";
import { cyrb53, idempotencyKey } from "./idempotency";

const KEY_RE = /^[A-Za-z0-9_-]{16,255}$/;

// A representative nonce shape, matching newNonce()'s two possible outputs in
// app/page.tsx: a UUID or a 32-char hex fallback.
const UUID_NONCE = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const HEX_NONCE = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

function payload(overrides: Partial<{
  name: string;
  amount: number;
  currency: string;
  method: string;
  message: string;
  keepSecret: boolean;
  email: string;
}> = {}) {
  const base = {
    name: "Naire",
    amount: 100,
    currency: "thb",
    method: "promptpay",
    message: "hello",
    keepSecret: false,
    email: "a@b.com",
  };
  const merged = { ...base, ...overrides };
  return [merged.name, merged.amount, merged.currency, merged.method, merged.message, merged.keepSecret, merged.email];
}

describe("cyrb53", () => {
  it("is deterministic for the same input", () => {
    expect(cyrb53("hello")).toBe(cyrb53("hello"));
  });

  it("differs for different input", () => {
    expect(cyrb53("hello")).not.toBe(cyrb53("hellp"));
  });
});

describe("idempotencyKey", () => {
  it("same nonce + same payload produces the same key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload());
    expect(a).toBe(b);
  });

  it("changed email produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ email: "c@d.com" }));
    expect(a).not.toBe(b);
  });

  it("changed method produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ method: "card" }));
    expect(a).not.toBe(b);
  });

  it("changed amount produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ amount: 200 }));
    expect(a).not.toBe(b);
  });

  it("changed currency produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ currency: "usd" }));
    expect(a).not.toBe(b);
  });

  it("changed message produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ message: "goodbye" }));
    expect(a).not.toBe(b);
  });

  it("changed keepSecret produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ keepSecret: true }));
    expect(a).not.toBe(b);
  });

  it("changed name produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(UUID_NONCE, payload({ name: "Someone else" }));
    expect(a).not.toBe(b);
  });

  it("a different nonce with the same payload produces a different key", () => {
    const a = idempotencyKey(UUID_NONCE, payload());
    const b = idempotencyKey(HEX_NONCE, payload());
    expect(a).not.toBe(b);
  });

  it("matches the server's key regex for a representative set of inputs, including empty fields and unicode", () => {
    const cases: unknown[][] = [
      payload(),
      payload({ email: "", name: "" }),
      payload({ message: "" }),
      payload({ name: "แนนนี่", message: "สู้ๆนะคะ 🌸 emoji test" }),
      payload({ amount: 0 }),
      payload({ keepSecret: true, method: "card", currency: "jpy" }),
    ];
    for (const nonce of [UUID_NONCE, HEX_NONCE]) {
      for (const parts of cases) {
        const key = idempotencyKey(nonce, parts);
        expect(key).toMatch(KEY_RE);
      }
    }
  });
});
