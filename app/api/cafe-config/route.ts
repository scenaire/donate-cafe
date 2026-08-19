import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  currentMonthName,
  PICK_TEMPLATE_DEFAULT,
  THANKS_TEMPLATE_DEFAULT,
  type Device,
  type DeviceEmotionImages,
  type DeviceSceneImages,
  type IdleLine,
  type VoiceTemplate,
  type WeatherTag,
} from "@/lib/cafe";
import { DEFAULT_PRIVACY, type PrivacyConfig } from "@/lib/moderation";

// PUBLIC café identity + voice config for the tip page: display name, the
// flower-of-month line, idle dialogue lines, the TTS voice threshold, and
// Naire's portrait/backdrop images. Same reasoning as /api/goal —
// unauthenticated because the tip page itself is, cached because it changes
// rarely.

const CACHE_SECONDS = 30;
const CACHE_HEADERS = {
  "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
};

const EMOTION_KEYS = ["neutral", "smile", "sad", "sparkle"] as const;
const SCENE_KEYS = ["day", "dusk", "night"] as const;
const DEVICES = ["mobile", "desktop"] as const;

function fillImages<K extends string>(keys: readonly K[], raw: unknown): Record<K, string | null> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<K, string | null>;
  for (const k of keys) out[k] = typeof src[k] === "string" ? (src[k] as string) : null;
  return out;
}

function fillDeviceImages<K extends string>(keys: readonly K[], raw: unknown): Record<Device, Record<K, string | null>> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<Device, Record<K, string | null>>;
  for (const d of DEVICES) out[d] = fillImages(keys, src[d]);
  return out;
}

export async function GET() {
  const { data, error } = await supabase
    .from("cafe_settings")
    .select("name, flower_of_month, idle_lines, tts_threshold_thb, real_voice_on, emotion_images, scene_images, privacy, pick_template, thanks_template, current_weather")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("Failed to load café config", error.message);
    return NextResponse.json({ error: "Could not fetch café config." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ config: null }, { headers: CACHE_HEADERS });
  }

  const flowerOfMonth = data.flower_of_month as string;
  const privacy = { ...DEFAULT_PRIVACY, ...(data.privacy as Partial<PrivacyConfig> | null) };

  return NextResponse.json(
    {
      config: {
        name: data.name as string,
        flowerOfMonth,
        flowerLine: `${currentMonthName()} · ${flowerOfMonth}`,
        idleLines: (data.idle_lines ?? []) as IdleLine[],
        ttsThresholdThb: data.tts_threshold_thb as number,
        realVoiceOn: data.real_voice_on as boolean,
        pickTemplate: (data.pick_template as VoiceTemplate | null) ?? PICK_TEMPLATE_DEFAULT,
        thanksTemplate: (data.thanks_template as VoiceTemplate | null) ?? THANKS_TEMPLATE_DEFAULT,
        currentWeather: (data.current_weather as WeatherTag | null) ?? null,
        emotionImages: fillDeviceImages(EMOTION_KEYS, data.emotion_images) as DeviceEmotionImages,
        sceneImages: fillDeviceImages(SCENE_KEYS, data.scene_images) as DeviceSceneImages,
        anonDefault: privacy.anonDefault,
        sealedAllowed: privacy.sealedAllowed,
      },
    },
    { headers: CACHE_HEADERS }
  );
}
