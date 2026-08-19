import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { stripHtml, clampString } from "@/lib/validate";
import { TIME_TAGS, WEATHER_TAGS, GUEST_TAGS, type ConditionTag, type WeatherTag } from "@/lib/cafe";

// Naire's voice: idle lines + the pick/thanks templates. Deliberately does
// NOT own tts_threshold_thb — that's a Prices concern that belongs to the
// (not yet built) Alerts overlay panel, not Voice; see cafe-panel/voice-panel
// memory for why. Voice only ever writes idle_lines / pick_template /
// thanks_template / current_weather.

const MAX_LINES = 24;
const MAX_LINE_LEN = 300;
const ALL_TAGS = new Set<string>([...TIME_TAGS, ...WEATHER_TAGS, ...GUEST_TAGS]);

function parseTags(raw: unknown): ConditionTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ConditionTag>();
  for (const t of raw) {
    if (typeof t === "string" && ALL_TAGS.has(t)) seen.add(t as ConditionTag);
  }
  return Array.from(seen);
}

function parseTemplate(raw: unknown, fallback: { th: string; en: string }) {
  const t = (raw ?? {}) as Record<string, unknown>;
  const th = clampString(stripHtml(typeof t.th === "string" ? t.th : ""), 400).trim();
  const en = clampString(stripHtml(typeof t.en === "string" ? t.en : ""), 400).trim();
  return { th: th || fallback.th, en: en || fallback.en };
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
  const b = (body ?? {}) as Record<string, unknown>;

  const rawLines = Array.isArray(b.idleLines) ? b.idleLines : [];
  const idleLines = rawLines
    .slice(0, MAX_LINES)
    .map((line, i) => {
      const l = (line ?? {}) as Record<string, unknown>;
      const id = typeof l.id === "string" && l.id ? l.id.slice(0, 60) : `line-${i}-${Date.now()}`;
      return {
        id,
        th: clampString(stripHtml(typeof l.th === "string" ? l.th : ""), MAX_LINE_LEN).trim(),
        en: clampString(stripHtml(typeof l.en === "string" ? l.en : ""), MAX_LINE_LEN).trim(),
        tags: parseTags(l.tags),
      };
    })
    .filter((l) => l.th || l.en);

  if (idleLines.length === 0) {
    return NextResponse.json({ error: "At least one idle line is required." }, { status: 400 });
  }

  const weatherRaw = b.currentWeather;
  const currentWeather: WeatherTag | null = typeof weatherRaw === "string" && (WEATHER_TAGS as string[]).includes(weatherRaw) ? (weatherRaw as WeatherTag) : null;

  const pickTemplate = parseTemplate(b.pickTemplate, { th: "", en: "" });
  const thanksTemplate = parseTemplate(b.thanksTemplate, { th: "", en: "" });
  if (!pickTemplate.th || !pickTemplate.en || !thanksTemplate.th || !thanksTemplate.en) {
    return NextResponse.json({ error: "Both templates need Thai and English text." }, { status: 400 });
  }

  const { error } = await supabase
    .from("cafe_settings")
    .update({
      idle_lines: idleLines,
      pick_template: pickTemplate,
      thanks_template: thanksTemplate,
      current_weather: currentWeather,
    })
    .eq("id", true);

  if (error) {
    console.error("Failed to update voice settings", error.message);
    return NextResponse.json({ error: "Could not save voice settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
