import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { clampString } from "@/lib/validate";
import { DEFAULT_JAR_CONFIG, JAR_HEIGHT_RANGE, type JarConfig, type JarAlign, type JarBacking, type JarFill, type JarMode, type JarPreset, type JarTexture } from "@/lib/cafe";

// Session-gated read/write for the Goal bar overlay panel's own widget
// styling/code — jar_config. Goal DATA (label/target/deadline/ending/
// visibility) stays in the goals table, edited by /api/settings/goal; this
// route only ever touches how the OBS bar looks. Doesn't touch widget_token —
// that's shared with Alerts, via /api/settings/alerts/regenerate-token.

const PRESETS = new Set<string>(["boba", "shelf", "minimal"]);
const FILLS = new Set<string>(["pink", "matcha", "lavender", "amber"]);
const TEXTURES = new Set<string>(["stripe", "solid"]);
const BACKINGS = new Set<string>(["cream", "dark", "outline"]);
const ALIGNS = new Set<string>(["left", "center", "right"]);
const MAX_CODE_LEN = 20_000;

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase.from("cafe_settings").select("jar_config").eq("id", true).maybeSingle();
  if (error) {
    console.error("Failed to load jar settings", error.message);
    return NextResponse.json({ error: "Could not fetch goal bar settings." }, { status: 500 });
  }

  const jarConfig: JarConfig = { ...DEFAULT_JAR_CONFIG, ...(data?.jar_config as Partial<JarConfig> | undefined) };
  return NextResponse.json({ jarConfig });
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

  const mode: JarMode = b.mode === "code" ? "code" : "simple";
  const rawPreset = typeof b.preset === "string" ? b.preset : "";
  const preset: JarPreset | null = PRESETS.has(rawPreset) ? (rawPreset as JarPreset) : null;

  const html = clampString(typeof b.html === "string" ? b.html : "", MAX_CODE_LEN);
  const css = clampString(typeof b.css === "string" ? b.css : "", MAX_CODE_LEN);
  const js = clampString(typeof b.js === "string" ? b.js : "", MAX_CODE_LEN);

  const fill: JarFill = FILLS.has(b.fill as string) ? (b.fill as JarFill) : DEFAULT_JAR_CONFIG.fill;
  const texture: JarTexture = TEXTURES.has(b.texture as string) ? (b.texture as JarTexture) : DEFAULT_JAR_CONFIG.texture;
  const backing: JarBacking = BACKINGS.has(b.backing as string) ? (b.backing as JarBacking) : DEFAULT_JAR_CONFIG.backing;
  const align: JarAlign = ALIGNS.has(b.align as string) ? (b.align as JarAlign) : DEFAULT_JAR_CONFIG.align;
  const heightPx = clampNum(b.heightPx, DEFAULT_JAR_CONFIG.heightPx, JAR_HEIGHT_RANGE.min, JAR_HEIGHT_RANGE.max);
  const showName = b.showName !== false;
  const showPct = b.showPct === true;
  const showAmount = b.showAmount !== false;

  const jarConfig: JarConfig = { mode, preset, html, css, js, fill, texture, backing, heightPx, showName, showPct, showAmount, align };

  const { error } = await supabase.from("cafe_settings").update({ jar_config: jarConfig }).eq("id", true);
  if (error) {
    console.error("Failed to update jar settings", error.message);
    return NextResponse.json({ error: "Could not save goal bar settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
