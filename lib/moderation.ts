// Configurable content moderation for names + messages: mask / hold / block
// per category, plus a handful of hold rules that don't depend on word
// matching at all. This is the runtime evaluator the Privacy & moderation
// Settings panel configures.
//
// Held/blocked orders are a DISPLAY decision only — the payment already
// succeeded by the time this runs; see lib/orders.ts / lib/realtime.ts for how
// moderation_status gates the alert pipeline without ever touching Stripe.

import { EN_BLOCKLIST, TH_BLOCKLIST } from "./profanity";
import { supabase } from "./supabase";

export type ModerationAction = "mask" | "hold" | "block";
export type ModerationStrictness = "off" | "standard";
export type ModerationStatus = "approved" | "held" | "blocked";

export type PrivacyConfig = {
  strictness: ModerationStrictness;
  actions: { message: ModerationAction; name: ModerationAction; tts: ModerationAction };
  blockWords: string[];
  allowWords: string[];
  holdRules: { firstTime: boolean; links: boolean; long: boolean; caps: boolean; repeat: boolean };
  anonDefault: boolean;
  queueOn: boolean;
  sealedAllowed: boolean;
};

// Reproduces today's exact behavior — see the migration comment. Used as the
// fallback when cafe_settings has no row yet, mirroring the pattern in
// lib/cafe.ts's fallback constants.
export const DEFAULT_PRIVACY: PrivacyConfig = {
  strictness: "standard",
  actions: { message: "mask", name: "mask", tts: "mask" },
  blockWords: [],
  allowWords: [],
  holdRules: { firstTime: false, links: false, long: false, caps: false, repeat: false },
  anonDefault: false,
  queueOn: true,
  sealedAllowed: true,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stars(len: number): string {
  return "*".repeat(Math.max(1, len));
}
// English-ish terms get word boundaries so "class" doesn't trip on "ass";
// anything else (Thai has no inter-word spacing) matches as a substring —
// same tradeoff lib/profanity.ts already makes.
function isAsciiWord(w: string): boolean {
  return /^[a-z0-9' -]+$/i.test(w);
}

// Every flagged term found in `text`, built-in lists + config.blockWords minus
// config.allowWords (case-insensitive). Empty when strictness is "off".
function findFlagged(text: string, cfg: PrivacyConfig): string[] {
  if (!text || cfg.strictness === "off") return [];
  const allow = new Set(cfg.allowWords.map((w) => w.toLowerCase()));
  const custom = cfg.blockWords.filter((w) => !allow.has(w.toLowerCase()));
  const enTerms = [...EN_BLOCKLIST, ...custom.filter(isAsciiWord)].filter((w) => !allow.has(w.toLowerCase()));
  const thTerms = [...TH_BLOCKLIST, ...custom.filter((w) => !isAsciiWord(w))].filter((w) => !allow.has(w.toLowerCase()));

  const found: string[] = [];
  if (enTerms.length) {
    const re = new RegExp(`\\b(?:${enTerms.map(escapeRegExp).join("|")})\\b`, "gi");
    found.push(...(text.match(re) ?? []));
  }
  if (thTerms.length) {
    const re = new RegExp(thTerms.map(escapeRegExp).join("|"), "g");
    found.push(...(text.match(re) ?? []));
  }
  return found;
}

function maskTerms(text: string, terms: string[]): string {
  let out = text;
  for (const t of new Set(terms.map((t) => t.toLowerCase()))) {
    out = out.replace(new RegExp(escapeRegExp(t), "gi"), (m) => stars(m.length));
  }
  return out;
}

const LINK_RE = /https?:\/\/\S+|www\.\S+|@[a-z0-9_]{2,}/i;
const REPEAT_RE = /(.)\1{3,}/; // same character 4+ times running
function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 6 && letters === letters.toUpperCase();
}

function worse(a: ModerationAction, b: ModerationAction): ModerationAction {
  const rank: Record<ModerationAction, number> = { mask: 0, hold: 1, block: 2 };
  return rank[b] > rank[a] ? b : a;
}

// SERVER ONLY (pulls in the service-role client transitively via ./supabase).
// Missing/partial config falls back to DEFAULT_PRIVACY field-by-field, so an
// older row from before some key existed doesn't throw.
export async function loadPrivacyConfig(): Promise<PrivacyConfig> {
  const { data, error } = await supabase.from("cafe_settings").select("privacy").eq("id", true).maybeSingle();
  if (error || !data?.privacy) return DEFAULT_PRIVACY;
  const p = data.privacy as Partial<PrivacyConfig>;
  return {
    strictness: p.strictness ?? DEFAULT_PRIVACY.strictness,
    actions: { ...DEFAULT_PRIVACY.actions, ...p.actions },
    blockWords: p.blockWords ?? DEFAULT_PRIVACY.blockWords,
    allowWords: p.allowWords ?? DEFAULT_PRIVACY.allowWords,
    holdRules: { ...DEFAULT_PRIVACY.holdRules, ...p.holdRules },
    anonDefault: p.anonDefault ?? DEFAULT_PRIVACY.anonDefault,
    queueOn: p.queueOn ?? DEFAULT_PRIVACY.queueOn,
    sealedAllowed: p.sealedAllowed ?? DEFAULT_PRIVACY.sealedAllowed,
  };
}

// First-time-supporter check for the holdRules.firstTime rule: is there
// already a SUCCESS order under this name? Approximate (name-matched, not
// identity-verified — guests aren't authenticated), skipped entirely for the
// "Anonymous" placeholder since it's shared by everyone who opts out.
export async function isFirstTimeSupporter(name: string): Promise<boolean> {
  if (!name || name.toLowerCase() === "anonymous") return false;
  // Escape ilike's own wildcards (% _) so a name containing them can't match
  // more broadly than the literal string typed.
  const pattern = name.replace(/[%_]/g, (c) => `\\${c}`);
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "SUCCESS")
    .ilike("customer_name", pattern);
  if (error) {
    console.error("isFirstTimeSupporter check failed", error.message);
    return false; // fail open — don't hold on an infra error
  }
  return (count ?? 0) === 0;
}

export type ModerationInput = {
  name: string;
  message: string;
  // Computed by the caller via a DB lookup — kept out of this function so it
  // stays pure/sync and easy to reason about in isolation.
  isFirstTimeSupporter: boolean;
};

export type ModerationResult = {
  status: ModerationStatus;
  ttsOk: boolean;
  name: string; // possibly masked
  message: string; // possibly masked
  reason: string | null; // human-readable, shown in the Settings queue
  word: string | null; // the specific matched term, for the queue's "remember" action
};

// The design gives message/name independent mask|hold|block actions; this
// collapses the two into one shared visibility outcome (the worse of the
// two), rather than gating name and message separately — a deliberate
// simplification to avoid the overlay needing to show "name hidden, message
// visible" (or vice versa) as its own state.
export function evaluateModeration(input: ModerationInput, cfg: PrivacyConfig): ModerationResult {
  const nameFlags = findFlagged(input.name, cfg);
  const msgFlags = findFlagged(input.message, cfg);

  let action: ModerationAction = "mask";
  let reason: string | null = null;
  const word: string | null = nameFlags[0] ?? msgFlags[0] ?? null;

  if (nameFlags.length) {
    action = worse(action, cfg.actions.name);
    reason = "flagged word in the name";
  }
  if (msgFlags.length) {
    action = worse(action, cfg.actions.message);
    reason = reason ?? "flagged word in the message";
  }

  // Hold rules never escalate past an existing block, and only fire while the
  // queue is on — with it off there is no review step for "hold" to wait on.
  if (cfg.queueOn && action !== "block") {
    if (cfg.holdRules.firstTime && input.isFirstTimeSupporter) {
      action = worse(action, "hold");
      reason = reason ?? "first message from a new supporter";
    }
    if (cfg.holdRules.links && LINK_RE.test(input.message)) {
      action = worse(action, "hold");
      reason = reason ?? "link or @mention in the message";
    }
    if (cfg.holdRules.long && input.message.length > 200) {
      action = worse(action, "hold");
      reason = reason ?? "longer than 200 characters";
    }
    if (cfg.holdRules.caps && isAllCaps(input.message)) {
      action = worse(action, "hold");
      reason = reason ?? "message is in all caps";
    }
    if (cfg.holdRules.repeat && REPEAT_RE.test(input.message)) {
      action = worse(action, "hold");
      reason = reason ?? "repeated characters";
    }
  }
  // Queue off ⇒ "hold" has nowhere to wait, so it degrades to "mask".
  if (!cfg.queueOn && action === "hold") action = "mask";

  const status: ModerationStatus = action === "block" ? "blocked" : action === "hold" ? "held" : "approved";

  // Masking happens immediately; held/blocked content stays exactly as typed
  // so the creator's queue shows the real text, not a redacted preview.
  const name = action === "mask" && nameFlags.length ? maskTerms(input.name, nameFlags) : input.name;
  const message = action === "mask" && msgFlags.length ? maskTerms(input.message, msgFlags) : input.message;

  // TTS is gated by overall approval first; beyond that, only an explicit
  // "block" on the tts category silences a flagged message's read-aloud —
  // mask/hold don't carry extra meaning here past the status they already produced.
  const flagged = nameFlags.length > 0 || msgFlags.length > 0;
  const ttsOk = status === "approved" && !(flagged && cfg.actions.tts === "block");

  return {
    status,
    ttsOk,
    name,
    message,
    reason: status === "approved" ? null : reason,
    word: status === "approved" ? null : word,
  };
}
