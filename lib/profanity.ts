// Names and messages go straight to the on-stream overlay and are read aloud by
// TTS, so this is the last line before something lands in a viewer's ears.
//
// Masking, not rejecting, is deliberate: a rejection tells a troll exactly which
// word tripped the filter and invites them to probe around it, while a silent
// mask looks to them like it went through. It also means a false positive on
// innocent Thai text costs a few asterisks rather than a lost payment.

// English needs word boundaries so "class" doesn't trip on "ass". Thai has no
// inter-word spacing, so those entries match as plain substrings.
export const EN_BLOCKLIST: string[] = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "dick",
  "pussy",
  "whore",
  "slut",
  "bastard",
  "retard",
  "nigger",
  "faggot",
];

// Substring matching means anything short enough to appear inside an innocent
// word is a liability. Deliberately excluded for that reason:
//   กู   — inside กูเกิล (Google)
//   สัด  — inside สัดส่วน (proportion)
//   หี   — inside หีบ (chest, casket)
//   แม่ง — inside แม่งาน (organiser)
//   มึง  — rude register rather than profanity, and extremely common between
//          friends, which is most of what this page receives
// Prefer longer, unambiguous terms when adding to this list.
export const TH_BLOCKLIST: string[] = [
  "เหี้ย",
  "สัส",
  "ควย",
  "เย็ด",
  "ไอ้สัตว์",
  "ระยำ",
  "ชิบหาย",
  "ฉิบหาย",
  "อีดอก",
  "กะหรี่",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Built once at module load — these lists are static.
const EN_RE = new RegExp(`\\b(?:${EN_BLOCKLIST.map(escapeRegExp).join("|")})\\b`, "gi");
const TH_RE = new RegExp(TH_BLOCKLIST.map(escapeRegExp).join("|"), "g");

function stars(len: number): string {
  return "*".repeat(Math.max(1, len));
}

// Replaces each blocked term with asterisks of the same length, preserving the
// surrounding text. Safe to call on empty strings.
export function maskProfanity(input: string): string {
  if (!input) return input;
  return input.replace(EN_RE, (m) => stars(m.length)).replace(TH_RE, (m) => stars(m.length));
}
