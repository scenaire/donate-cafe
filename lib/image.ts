// **SERVER ONLY.** May load sharp (a native module) — never import from a
// `"use client"` file.
//
// The one place café asset bytes get normalised. Both the Settings upload route
// and the asset backfill script go through `toWebp`, so a file uploaded today
// and a file converted retroactively come out byte-for-byte identical.
//
// Why this exists at all: the tip page renders these with a plain <img> or
// background-image straight from the public bucket — no next/image, no `images`
// config — so the stored bytes are exactly what every guest downloads. There is
// no optimisation step later in the chain to lean on.

// Longest-edge caps, ~2x the largest size each asset actually renders at
// (measured on the tip page: menu thumbs 122px square, the portrait/backdrop
// rail 325x435). Downscale only — `withoutEnlargement` keeps small pixel art
// from being blown up into a bigger file that shows no extra detail.
export const MAX_EDGE: Record<string, number> = { menu: 512, emote: 1024, scene: 1400 };
export const DEFAULT_MAX_EDGE = 1024;

// Keys are UUIDs and a given key is never rewritten, so these are immutable —
// cache them for a year instead of Supabase's 1-hour default, which otherwise
// makes returning guests re-fetch every portrait hourly.
export const CACHE_CONTROL = String(365 * 24 * 60 * 60);

export type EncodedImage = { bytes: Uint8Array; contentType: string; ext: string };

// Re-encode to WebP and downscale to the folder's cap. Returns the original
// bytes untouched if sharp can't read the file — a creator with a working
// upload flow shouldn't lose it to an encoder edge case, and an oversized PNG
// is a much smaller problem than a broken Settings panel.
//
// PNG and GIF go through *lossless* WebP on purpose. This café's art is pixel
// art and flat illustration, which is exactly what lossy WebP smears: ringing
// around the hard edges and dither patterns. Lossless still lands well under
// the source PNG, and the edge cap does most of the real work anyway. JPEG
// sources are photographs by definition, so those take the lossy path.
export async function toWebp(
  bytes: Uint8Array,
  type: string,
  ext: string,
  folder: string,
): Promise<EncodedImage> {
  const animated = type === "image/gif";
  const lossless = type === "image/png" || type === "image/gif";
  const cap = MAX_EDGE[folder] ?? DEFAULT_MAX_EDGE;
  try {
    // Load lazily: sharp ships a platform-specific native binary, so a deploy
    // made from a different OS must not make the entire upload route unusable.
    // The fallback below deliberately preserves the creator's original image.
    const { default: sharp } = await import("sharp");
    let pipeline = sharp(bytes, { animated });
    // EXIF orientation only applies to stills, and sharp rejects rotate() on a
    // multi-frame image — so phone-camera uploads get straightened, GIFs don't.
    if (!animated) pipeline = pipeline.rotate();
    const out = await pipeline
      .resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true })
      .webp(lossless ? { lossless: true, effort: 6 } : { quality: 82, effort: 6 })
      .toBuffer();
    return { bytes: new Uint8Array(out), contentType: "image/webp", ext: "webp" };
  } catch (e) {
    console.error("Asset re-encode failed, storing original", e instanceof Error ? e.message : e);
    return { bytes, contentType: type, ext };
  }
}
