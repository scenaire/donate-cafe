import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { clampString } from "@/lib/validate";
import {
  ALERT_DURATION_RANGE,
  ALERT_MIN_AMOUNT_RANGE,
  ALERT_SPAWN_GAP_RANGE,
  ALERT_TTS_THRESHOLD_RANGE,
  ALERT_VOLUME_RANGE,
  DEFAULT_ALERT_CONFIG,
  type AlertConfig,
  type AlertMode,
  type AlertPreset,
} from "@/lib/cafe";

// Session-gated read/write for the Alerts overlay panel: alert_config (SIMPLE
// vs CODE mode, behaviour sliders, custom HTML/CSS/JS), tts_threshold_thb, and
// real_voice_on — tts_threshold_thb moved here from Voice, see that route's
// header for why. Does NOT touch widget_token; that's
// app/api/settings/alerts/regenerate-token.
//
// Two unrelated things both live under "TTS" here and must not be conflated:
//   - alert_config.ttsOn — Google TTS on the OBS overlay. Reads every alert
//     that clears minAmountThb aloud in a synthesized voice; has no separate
//     amount threshold of its own.
//   - real_voice_on + tts_threshold_thb — the tip page's "real voice" promise
//     (Naire reads it herself, live, above this amount). Purely a tip-page
//     display/emotion trigger; never gates the overlay's Google TTS.

const PRESETS = new Set<string>(["polaroid", "receipt", "bubble"]);
const MAX_CODE_LEN = 20_000;

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("cafe_settings")
    .select("alert_config, tts_threshold_thb, real_voice_on, widget_token")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("Failed to load alert settings", error.message);
    return NextResponse.json({ error: "Could not fetch alert settings." }, { status: 500 });
  }

  const alertConfig = { ...DEFAULT_ALERT_CONFIG, ...(data?.alert_config as Partial<AlertConfig> | null) };

  return NextResponse.json({
    alertConfig,
    ttsThresholdThb: (data?.tts_threshold_thb as number | undefined) ?? ALERT_TTS_THRESHOLD_RANGE.max,
    realVoiceOn: (data?.real_voice_on as boolean | undefined) ?? true,
    widgetToken: (data?.widget_token as string | undefined) ?? "",
  });
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

  const mode: AlertMode = b.mode === "code" ? "code" : "simple";
  const rawPreset = typeof b.preset === "string" ? b.preset : "";
  const preset: AlertPreset | null = PRESETS.has(rawPreset) ? (rawPreset as AlertPreset) : null;

  // CODE mode is admin-authored (requireAdmin gates this whole route) and
  // deliberately not HTML-stripped — it IS supposed to contain HTML/CSS/JS.
  // Length-clamped only, to keep a stray paste from bloating the row forever.
  const html = clampString(typeof b.html === "string" ? b.html : "", MAX_CODE_LEN);
  const css = clampString(typeof b.css === "string" ? b.css : "", MAX_CODE_LEN);
  const js = clampString(typeof b.js === "string" ? b.js : "", MAX_CODE_LEN);

  const durationSec = clampNum(b.durationSec, DEFAULT_ALERT_CONFIG.durationSec, ALERT_DURATION_RANGE.min, ALERT_DURATION_RANGE.max);
  const minAmountThb = clampNum(b.minAmountThb, DEFAULT_ALERT_CONFIG.minAmountThb, ALERT_MIN_AMOUNT_RANGE.min, ALERT_MIN_AMOUNT_RANGE.max);
  const spawnGapSec = clampNum(b.spawnGapSec, DEFAULT_ALERT_CONFIG.spawnGapSec, ALERT_SPAWN_GAP_RANGE.min, ALERT_SPAWN_GAP_RANGE.max);
  const soundOn = b.soundOn !== false;
  const ttsOn = b.ttsOn !== false;
  const soundVolume = clampNum(b.soundVolume, DEFAULT_ALERT_CONFIG.soundVolume, ALERT_VOLUME_RANGE.min, ALERT_VOLUME_RANGE.max);

  const ttsThresholdThb = clampNum(b.ttsThresholdThb, ALERT_TTS_THRESHOLD_RANGE.max, ALERT_TTS_THRESHOLD_RANGE.min, ALERT_TTS_THRESHOLD_RANGE.max);
  const realVoiceOn = b.realVoiceOn !== false;

  const alertConfig: AlertConfig = { mode, preset, html, css, js, durationSec, minAmountThb, spawnGapSec, soundOn, ttsOn, soundVolume };

  const { error } = await supabase
    .from("cafe_settings")
    .update({ alert_config: alertConfig, tts_threshold_thb: ttsThresholdThb, real_voice_on: realVoiceOn })
    .eq("id", true);

  if (error) {
    console.error("Failed to update alert settings", error.message);
    return NextResponse.json({ error: "Could not save alert settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
