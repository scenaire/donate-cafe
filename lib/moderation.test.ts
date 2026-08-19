import { describe, it, expect } from "vitest";
import { evaluateModeration, DEFAULT_PRIVACY, type PrivacyConfig } from "./moderation";

// evaluateModeration is the pure gate that decides what a paid tip is allowed to
// do on-stream: whether it shows at all (approved/held/blocked), whether its
// text is masked, and whether TTS may read it. It runs on every successful
// payment, so its behaviour is worth pinning down precisely — a regression here
// leaks unmoderated content to a live audience or silently swallows clean tips.
//
// Only the pure evaluator is exercised here; loadPrivacyConfig /
// isFirstTimeSupporter hit the database and belong to route-level tests.

type PrivacyOverrides = Partial<Omit<PrivacyConfig, "actions" | "holdRules">> & {
  actions?: Partial<PrivacyConfig["actions"]>;
  holdRules?: Partial<PrivacyConfig["holdRules"]>;
};

function cfg(overrides: PrivacyOverrides = {}): PrivacyConfig {
  return {
    ...DEFAULT_PRIVACY,
    ...overrides,
    // Deep-merge the nested objects so a caller can override one sub-key
    // without wiping the rest (matches how loadPrivacyConfig fills them).
    actions: { ...DEFAULT_PRIVACY.actions, ...overrides.actions },
    holdRules: { ...DEFAULT_PRIVACY.holdRules, ...overrides.holdRules },
  };
}

const clean = { name: "Alice", message: "great stream!", isFirstTimeSupporter: false };

describe("evaluateModeration — clean input", () => {
  it("approves clean text unchanged, with TTS allowed", () => {
    const r = evaluateModeration(clean, cfg());
    expect(r.status).toBe("approved");
    expect(r.name).toBe("Alice");
    expect(r.message).toBe("great stream!");
    expect(r.ttsOk).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.word).toBeNull();
  });

  it("strictness 'off' lets even a blocked word through untouched", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ strictness: "off", blockWords: ["badword"] })
    );
    expect(r.status).toBe("approved");
    expect(r.message).toBe("you badword");
    expect(r.word).toBeNull();
  });
});

describe("evaluateModeration — masking (approved but redacted)", () => {
  it("masks a flagged word in the message when the message action is 'mask'", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword here", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "mask" } })
    );
    expect(r.status).toBe("approved");
    expect(r.message).toBe("you ******* here");
    // A masked tip is still approved, so the queue-facing fields stay null.
    expect(r.reason).toBeNull();
    expect(r.word).toBeNull();
  });

  it("masks a flagged word in the name when the name action is 'mask'", () => {
    const r = evaluateModeration(
      { name: "badword", message: "hi", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { name: "mask" } })
    );
    expect(r.status).toBe("approved");
    expect(r.name).toBe("*******");
    expect(r.message).toBe("hi");
  });

  it("respects word boundaries on ASCII terms — an innocent superstring survives", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "classic bassline", isFirstTimeSupporter: false },
      cfg({ blockWords: ["ass"] })
    );
    expect(r.status).toBe("approved");
    expect(r.message).toBe("classic bassline");
  });
});

describe("evaluateModeration — hold", () => {
  it("holds (without masking) when the message action is 'hold' and the queue is on", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "hold" }, queueOn: true })
    );
    expect(r.status).toBe("held");
    // Held content is kept exactly as typed so the creator's queue sees the truth.
    expect(r.message).toBe("you badword");
    expect(r.reason).toBe("flagged word in the message");
    expect(r.word).toBe("badword");
    expect(r.ttsOk).toBe(false);
  });

  it("degrades 'hold' to 'mask' when the queue is off (nothing to wait on)", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "hold" }, queueOn: false })
    );
    expect(r.status).toBe("approved");
    expect(r.message).toBe("you *******");
  });

  it("holds a first-time supporter when holdRules.firstTime is on", () => {
    const r = evaluateModeration(
      { name: "Newbie", message: "hello!", isFirstTimeSupporter: true },
      cfg({ holdRules: { firstTime: true }, queueOn: true })
    );
    expect(r.status).toBe("held");
    expect(r.reason).toBe("first message from a new supporter");
  });

  it("holds a message containing a link", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "check https://evil.example", isFirstTimeSupporter: false },
      cfg({ holdRules: { links: true }, queueOn: true })
    );
    expect(r.status).toBe("held");
    expect(r.reason).toBe("link or @mention in the message");
  });

  it("holds an over-long message", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "x".repeat(201), isFirstTimeSupporter: false },
      cfg({ holdRules: { long: true }, queueOn: true })
    );
    expect(r.status).toBe("held");
    expect(r.reason).toBe("longer than 200 characters");
  });

  it("holds an all-caps message", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "SHOUTING LOUDLY", isFirstTimeSupporter: false },
      cfg({ holdRules: { caps: true }, queueOn: true })
    );
    expect(r.status).toBe("held");
    expect(r.reason).toBe("message is in all caps");
  });

  it("holds a message with 4+ repeated characters", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "wooooow", isFirstTimeSupporter: false },
      cfg({ holdRules: { repeat: true }, queueOn: true })
    );
    expect(r.status).toBe("held");
    expect(r.reason).toBe("repeated characters");
  });

  it("does not fire hold rules when the queue is off", () => {
    const r = evaluateModeration(
      { name: "Newbie", message: "check https://x.example", isFirstTimeSupporter: true },
      cfg({ holdRules: { firstTime: true, links: true }, queueOn: false })
    );
    expect(r.status).toBe("approved");
  });
});

describe("evaluateModeration — block", () => {
  it("blocks (without masking) when the action is 'block' and silences TTS", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "block" } })
    );
    expect(r.status).toBe("blocked");
    expect(r.message).toBe("you badword");
    expect(r.ttsOk).toBe(false);
    expect(r.word).toBe("badword");
  });

  it("takes the worse action across name and message", () => {
    const r = evaluateModeration(
      { name: "badname", message: "also badmsg", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badname", "badmsg"], actions: { name: "mask", message: "block" } })
    );
    expect(r.status).toBe("blocked");
  });

  it("hold rules never escalate past an existing block", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "badword https://x.example", isFirstTimeSupporter: true },
      cfg({ blockWords: ["badword"], actions: { message: "block" }, holdRules: { firstTime: true, links: true }, queueOn: true })
    );
    expect(r.status).toBe("blocked");
  });
});

describe("evaluateModeration — allow/block word lists", () => {
  it("allowWords rescues a term that would otherwise be flagged", () => {
    // With the default 'mask' action the flagged term is redacted (still an
    // approved status, but the text changes) …
    const flagged = evaluateModeration(
      { name: "Bob", message: "totally badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"] })
    );
    expect(flagged.message).toBe("totally *******");

    // … and allowlisting it leaves the message completely untouched.
    const rescued = evaluateModeration(
      { name: "Bob", message: "totally badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], allowWords: ["badword"] })
    );
    expect(rescued.status).toBe("approved");
    expect(rescued.message).toBe("totally badword");
  });
});

describe("evaluateModeration — TTS gating", () => {
  it("silences TTS on an approved-but-masked message when tts action is 'block'", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "mask", tts: "block" } })
    );
    expect(r.status).toBe("approved");
    expect(r.ttsOk).toBe(false);
  });

  it("keeps TTS on for an approved-and-masked message when tts action is not 'block'", () => {
    const r = evaluateModeration(
      { name: "Bob", message: "you badword", isFirstTimeSupporter: false },
      cfg({ blockWords: ["badword"], actions: { message: "mask", tts: "mask" } })
    );
    expect(r.status).toBe("approved");
    expect(r.ttsOk).toBe(true);
  });
});
