import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { stripHtml, clampString } from "@/lib/validate";
import { DEFAULT_PRIVACY, type ModerationAction, type PrivacyConfig } from "@/lib/moderation";

const MAX_WORDS = 200;
const MAX_WORD_LEN = 60;
const ACTIONS: ModerationAction[] = ["mask", "hold", "block"];

function parseAction(v: unknown, fallback: ModerationAction): ModerationAction {
  return typeof v === "string" && (ACTIONS as string[]).includes(v) ? (v as ModerationAction) : fallback;
}
function parseWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw) {
    if (typeof w !== "string") continue;
    const clean = clampString(stripHtml(w), MAX_WORD_LEN).trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
      if (out.length >= MAX_WORDS) break;
    }
  }
  return out;
}
function parsePrivacy(body: unknown): PrivacyConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const actions = (b.actions ?? {}) as Record<string, unknown>;
  const holdRules = (b.holdRules ?? {}) as Record<string, unknown>;
  return {
    strictness: b.strictness === "off" ? "off" : "standard",
    actions: {
      message: parseAction(actions.message, DEFAULT_PRIVACY.actions.message),
      name: parseAction(actions.name, DEFAULT_PRIVACY.actions.name),
      tts: parseAction(actions.tts, DEFAULT_PRIVACY.actions.tts),
    },
    blockWords: parseWords(b.blockWords),
    allowWords: parseWords(b.allowWords),
    holdRules: {
      firstTime: holdRules.firstTime === true,
      links: holdRules.links === true,
      long: holdRules.long === true,
      caps: holdRules.caps === true,
      repeat: holdRules.repeat === true,
    },
    anonDefault: b.anonDefault === true,
    queueOn: b.queueOn !== false,
    sealedAllowed: b.sealedAllowed !== false,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase.from("cafe_settings").select("privacy").eq("id", true).maybeSingle();
  if (error) {
    console.error("Failed to load privacy settings", error.message);
    return NextResponse.json({ error: "Could not fetch privacy settings." }, { status: 500 });
  }
  return NextResponse.json({ privacy: (data?.privacy as PrivacyConfig | undefined) ?? DEFAULT_PRIVACY });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const privacy = parsePrivacy(body);
  const { error } = await supabase.from("cafe_settings").update({ privacy }).eq("id", true);
  if (error) {
    console.error("Failed to update privacy settings", error.message);
    return NextResponse.json({ error: "Could not save privacy settings." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
