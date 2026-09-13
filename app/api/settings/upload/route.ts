import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-server";
import { supabase } from "@/lib/supabase";
import { toWebp, CACHE_CONTROL } from "@/lib/image";

// Session-gated image upload for café assets (menu thumbs, emotion portraits,
// scene backdrops). Accepts a single image via multipart form-data, stores it in the
// public `cafe-assets` bucket, and returns its public URL — the caller then
// persists that URL on the relevant row (e.g. menu_items.thumb_url).
//
// Uploads go through the service-role client (bypasses storage RLS); the bucket
// is public-read, so the returned URL is directly usable on the tip page.
//
// Nothing resizes or re-encodes these on the way out: the tip page renders them
// with a plain <img>/background-image straight from the bucket (no next/image,
// no `images` config), so the stored bytes are exactly what every guest
// downloads. That makes this route the place the weight has to be fixed — it
// normalises everything through lib/image.ts, which scripts/backfill-assets.ts
// also uses so new and retroactively-converted files come out identical.

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — treat thumbnails, not hero art
const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return NextResponse.json({ error: "Only PNG, JPEG, WebP or GIF images are allowed." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 3 MB or smaller." }, { status: 413 });
  }

  // Namespaced, collision-free key. The `folder` prefix keeps different asset
  // kinds tidy in the bucket (menu/, emote/, scene/) and picks the size cap.
  const folderRaw = form.get("folder");
  const folder = typeof folderRaw === "string" && /^[a-z0-9_-]{1,24}$/.test(folderRaw) ? folderRaw : "menu";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { bytes: outBytes, contentType, ext: outExt } = await toWebp(bytes, file.type, ext, folder);

  const key = `${folder}/${crypto.randomUUID()}.${outExt}`;
  const { error } = await supabase.storage.from("cafe-assets").upload(key, outBytes, {
    contentType,
    cacheControl: CACHE_CONTROL,
    upsert: false,
  });
  if (error) {
    console.error("Asset upload failed", error.message);
    return NextResponse.json({ error: "Could not upload the image." }, { status: 500 });
  }

  const { data } = supabase.storage.from("cafe-assets").getPublicUrl(key);
  return NextResponse.json({ url: data.publicUrl, key });
}
