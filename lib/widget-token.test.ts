import { describe, it, expect, vi, beforeEach } from "vitest";

// The widget token gates every OBS-widget route (alerts, TTS, summary, goal
// bar). The security-critical property is that it FAILS CLOSED: a null/empty
// candidate, an unset stored token, or a DB error must never validate. We mock
// the service-role client so these tests exercise only the guard logic.
const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

import { getWidgetToken, isValidWidgetToken } from "./widget-token";

function storedToken(value: string | null, error: { message: string } | null = null) {
  maybeSingle.mockResolvedValue({ data: value === null ? null : { widget_token: value }, error });
}

beforeEach(() => maybeSingle.mockReset());

describe("getWidgetToken", () => {
  it("returns the stored token", async () => {
    storedToken("s3cret");
    expect(await getWidgetToken()).toBe("s3cret");
  });

  it("returns null when no row / no token is stored", async () => {
    storedToken(null);
    expect(await getWidgetToken()).toBeNull();
  });

  it("returns null on a DB error rather than throwing", async () => {
    storedToken(null, { message: "boom" });
    expect(await getWidgetToken()).toBeNull();
  });
});

describe("isValidWidgetToken — fails closed", () => {
  it("rejects a null or empty candidate without even querying", async () => {
    expect(await isValidWidgetToken(null)).toBe(false);
    expect(await isValidWidgetToken("")).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects any candidate when no token is configured", async () => {
    storedToken(null);
    expect(await isValidWidgetToken("anything")).toBe(false);
  });

  it("rejects a candidate that does not match the stored token", async () => {
    storedToken("s3cret");
    expect(await isValidWidgetToken("wrong")).toBe(false);
  });

  it("accepts the exact stored token", async () => {
    storedToken("s3cret");
    expect(await isValidWidgetToken("s3cret")).toBe(true);
  });
});
