import { describe, it, expect, vi, afterEach } from "vitest";
import {
  timeTagForHour,
  pickIdleLine,
  renderTemplate,
  currentMonthName,
  type IdleLine,
} from "./cafe";

// The Voice condition engine: which of Naire's idle lines shows depends on the
// time of day / weather / who the guest is, and templates fill in the pick and
// thank-you moments. These functions are pure; the DB-backed config that feeds
// them is exercised at the route level.

describe("timeTagForHour", () => {
  it.each([
    [0, "night"],
    [4, "night"],
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "dusk"],
    [20, "dusk"],
    [21, "night"],
    [23, "night"],
  ] as const)("maps hour %i to %s", (hour, tag) => {
    expect(timeTagForHour(hour)).toBe(tag);
  });
});

describe("pickIdleLine — most specific match wins", () => {
  afterEach(() => vi.restoreAllMocks());

  const line = (id: string, tags: IdleLine["tags"]): IdleLine => ({ id, th: id, en: id, tags });

  it("prefers the line with the most tags among those fully active", () => {
    const generic = line("generic", ["morning"]);
    const specific = line("specific", ["morning", "rain"]);
    // Deterministic: force the random pick to index 0 (best has length 1 here).
    vi.spyOn(Math, "random").mockReturnValue(0);
    const chosen = pickIdleLine([generic, specific], ["morning", "rain"]);
    expect(chosen.id).toBe("specific");
  });

  it("ignores lines whose tags are not all currently active", () => {
    const nightLine = line("night", ["night"]);
    const untagged = line("fallback", []);
    // activeTags has no "night", so nightLine is disqualified and the untagged
    // fallback is the only candidate.
    const chosen = pickIdleLine([nightLine, untagged], ["morning"]);
    expect(chosen.id).toBe("fallback");
  });

  it("treats an untagged line as always eligible", () => {
    const untagged = line("fallback", []);
    const chosen = pickIdleLine([untagged], ["morning", "rain"]);
    expect(chosen.id).toBe("fallback");
  });

  it("falls back to the whole pool when nothing matches the active tags", () => {
    // No untagged line and no active tag matches — every line is disqualified,
    // so the pool becomes all lines and the most specific of those is chosen.
    const a = line("a", ["night"]);
    const b = line("b", ["night", "rain"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const chosen = pickIdleLine([a, b], ["morning"]);
    expect(chosen.id).toBe("b");
  });

  it("avoids repeating excludeId when an alternative of equal specificity exists", () => {
    const a = line("a", ["morning"]);
    const b = line("b", ["morning"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const chosen = pickIdleLine([a, b], ["morning"], "a");
    expect(chosen.id).toBe("b");
  });

  it("returns excludeId anyway when it is the only best line (never undefined)", () => {
    const only = line("solo", ["morning"]);
    const chosen = pickIdleLine([only], ["morning"], "solo");
    expect(chosen.id).toBe("solo");
  });
});

describe("renderTemplate", () => {
  it("substitutes known tokens", () => {
    expect(renderTemplate("{{name}} tipped {{amount}}", { name: "Al", amount: "฿100" })).toBe("Al tipped ฿100");
  });

  it("resolves unknown or absent tokens to an empty string", () => {
    expect(renderTemplate("hi {{name}}{{missing}}", { name: "Al" })).toBe("hi Al");
    expect(renderTemplate("{{item}} for you", {})).toBe(" for you");
  });

  it("replaces every occurrence of a repeated token", () => {
    expect(renderTemplate("{{name}} {{name}}", { name: "Al" })).toBe("Al Al");
  });

  it("leaves text without tokens untouched", () => {
    expect(renderTemplate("no tokens here", { name: "Al" })).toBe("no tokens here");
  });
});

describe("currentMonthName", () => {
  it("names the month in English from the UTC month", () => {
    expect(currentMonthName(new Date("2026-08-18T00:00:00Z"))).toBe("August");
    expect(currentMonthName(new Date("2026-01-01T00:00:00Z"))).toBe("January");
    expect(currentMonthName(new Date("2026-12-31T12:00:00Z"))).toBe("December");
  });
});
