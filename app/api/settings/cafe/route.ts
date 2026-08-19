import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { stripHtml, clampString } from "@/lib/validate";

const EMOTION_KEYS = ["neutral", "smile", "sad", "sparkle"] as const;
const SCENE_KEYS = ["day", "dusk", "night"] as const;
const DEVICES = ["mobile", "desktop"] as const;

// Only accept a same-origin Supabase Storage URL (or empty, to clear the
// slot) — same guard as menu_items.thumb_url, so an arbitrary URL can never
// be stored and rendered on the public tip page.
function parseImageMap<K extends string>(keys: readonly K[], raw: unknown): Record<K, string | null> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<K, string | null>;
  for (const k of keys) {
    const v = src[k];
    out[k] = typeof v === "string" && v.includes("/storage/v1/object/public/cafe-assets/") ? v : null;
  }
  return out;
}

function parseDeviceImageMap<K extends string>(keys: readonly K[], raw: unknown) {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<(typeof DEVICES)[number], Record<K, string | null>>;
  for (const d of DEVICES) out[d] = parseImageMap(keys, src[d]);
  return out;
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

  const rawName = typeof b.name === "string" ? b.name : "";
  const name = clampString(stripHtml(rawName), 60).trim();
  if (!name) return NextResponse.json({ error: "Café name is required." }, { status: 400 });

  const rawFlower = typeof b.flowerOfMonth === "string" ? b.flowerOfMonth : "";
  const flowerOfMonth = clampString(stripHtml(rawFlower), 60).trim();
  if (!flowerOfMonth) {
    return NextResponse.json({ error: "Flower of the month is required." }, { status: 400 });
  }

  const emotion_images = parseDeviceImageMap(EMOTION_KEYS, b.emotionImages);
  const scene_images = parseDeviceImageMap(SCENE_KEYS, b.sceneImages);

  const { error } = await supabase
    .from("cafe_settings")
    .update({ name, flower_of_month: flowerOfMonth, emotion_images, scene_images })
    .eq("id", true);

  if (error) {
    console.error("Failed to update café settings", error.message);
    return NextResponse.json({ error: "Could not save café settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
