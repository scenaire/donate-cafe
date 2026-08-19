import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isValidWidgetToken } from "@/lib/widget-token";
import { ALERT_TTS_THRESHOLD_RANGE, DEFAULT_ALERT_CONFIG, type AlertConfig } from "@/lib/cafe";

// Token-gated (same widget token as /api/recent-alerts et al.), read by the
// live /alert overlay on load and each reconciliation poll — so a behaviour
// or CODE-mode edit saved in Settings reaches an already-open OBS source
// without needing to reload it.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!(await isValidWidgetToken(token))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase.from("cafe_settings").select("alert_config, tts_threshold_thb").eq("id", true).maybeSingle();
  if (error) {
    console.error("Failed to load alert config", error.message);
    return NextResponse.json({ error: "Could not fetch alert config." }, { status: 500 });
  }

  const alertConfig = { ...DEFAULT_ALERT_CONFIG, ...(data?.alert_config as Partial<AlertConfig> | null) };

  return NextResponse.json({
    alertConfig,
    ttsThresholdThb: (data?.tts_threshold_thb as number | undefined) ?? ALERT_TTS_THRESHOLD_RANGE.max,
  });
}
