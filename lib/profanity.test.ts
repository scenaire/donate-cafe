import { describe, it, expect } from "vitest";
import { maskProfanity } from "./profanity";

describe("maskProfanity — English", () => {
  it("masks a blocked word with equal-length asterisks", () => {
    expect(maskProfanity("you fuck are great")).toBe("you **** are great");
  });

  it("respects word boundaries: 'class' survives even though it contains 'ass'-adjacent substrings", () => {
    // "ass" is not itself in EN_BLOCKLIST, but this guards the word-boundary
    // matching strategy generally: a blocked word embedded in a longer,
    // innocent word must not be masked.
    expect(maskProfanity("this class is great")).toBe("this class is great");
  });

  it("is case-insensitive", () => {
    expect(maskProfanity("FUCK this")).toBe("**** this");
  });

  it("leaves clean text untouched", () => {
    expect(maskProfanity("thank you so much!")).toBe("thank you so much!");
  });

  it("is safe on empty input", () => {
    expect(maskProfanity("")).toBe("");
  });
});

describe("maskProfanity — Thai substring exclusions", () => {
  const exclusions = ["กูเกิล", "สัดส่วน", "หีบ", "แม่งาน"];

  it.each(exclusions)("%s survives unmasked", (word) => {
    expect(maskProfanity(word)).toBe(word);
  });

  it("still masks an actual blocked Thai term", () => {
    expect(maskProfanity("เหี้ย")).not.toBe("เหี้ย");
    expect(maskProfanity("เหี้ย")).toBe("*".repeat("เหี้ย".length));
  });
});
