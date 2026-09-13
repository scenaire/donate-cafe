// One-time backfill: re-encode the café assets already sitting in the bucket.
//
//   npm run backfill:assets -- --dry-run   # show what would happen, write nothing
//   npm run backfill:assets                # convert and repoint
//   npm run backfill:assets -- --dedupe    # also collapse byte-identical sources
//
// The Settings upload route normalises everything to WebP on the way in (see
// lib/image.ts), but that only helps files uploaded *after* it landed. This
// converts the ones already stored, through the exact same encoder.
//
// Idempotent — anything already `.webp` is skipped, so it is safe to re-run if
// it dies partway through.
//
// NOTHING IS DELETED. The originals stay in the bucket after the rows are
// repointed, which makes the whole run reversible, and matters for one reason
// that isn't obvious: orders.item_photo_url is a *snapshot* of the photo shown
// at the time of the tip. Those rows are a historical record and this script
// deliberately does not rewrite them — deleting the originals would leave every
// past order pointing at a dead URL.

import { createHash } from "node:crypto";
import { supabase } from "../lib/supabase";
import { toWebp, CACHE_CONTROL } from "../lib/image";

const DRY_RUN = process.argv.includes("--dry-run");
const DEDUPE = process.argv.includes("--dedupe");

const BUCKET = "cafe-assets";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

const EMOTION_KEYS = ["neutral", "smile", "sad", "sparkle"] as const;
const SCENE_KEYS = ["day", "dusk", "night"] as const;
const DEVICES = ["mobile", "desktop"] as const;

type DeviceMap = Record<string, Record<string, string | null>>;

// A URL is only ours if it points into our own public bucket — the same guard
// the Settings routes apply before storing one.
function keyFromUrl(url: string): string | null {
  const i = url.indexOf(PUBLIC_MARKER);
  return i === -1 ? null : url.slice(i + PUBLIC_MARKER.length);
}

function folderFromKey(key: string): string {
  const i = key.indexOf("/");
  return i === -1 ? "menu" : key.slice(0, i);
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function kb(n: number) {
  return `${(n / 1024).toFixed(1)}KB`;
}

// Every device/key slot in one of the jsonb maps, walked in a fixed order so
// dry-run output is stable between runs.
function walkDeviceMap(map: DeviceMap, keys: readonly string[], fn: (url: string) => void) {
  for (const d of DEVICES) for (const k of keys) {
    const v = map?.[d]?.[k];
    if (typeof v === "string" && v) fn(v);
  }
}

function rewriteDeviceMap(map: DeviceMap, keys: readonly string[], moved: Map<string, string>): DeviceMap {
  const out: DeviceMap = {};
  for (const d of DEVICES) {
    out[d] = {};
    for (const k of keys) {
      const v = map?.[d]?.[k];
      out[d][k] = typeof v === "string" && v ? (moved.get(v) ?? v) : (v ?? null);
    }
  }
  return out;
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "Converting café assets to WebP…\n");

  // ── Collect every asset URL currently referenced by a live row ────────────
  const { data: items, error: itemsErr } = await supabase.from("menu_items").select("id, thumb_url");
  if (itemsErr) throw new Error(`menu_items read failed: ${itemsErr.message}`);

  const { data: settings, error: settingsErr } = await supabase
    .from("cafe_settings")
    .select("id, emotion_images, scene_images")
    .eq("id", true)
    .maybeSingle();
  if (settingsErr) throw new Error(`cafe_settings read failed: ${settingsErr.message}`);

  const referenced = new Set<string>();
  for (const it of items ?? []) if (it.thumb_url) referenced.add(it.thumb_url as string);
  if (settings) {
    walkDeviceMap(settings.emotion_images as DeviceMap, EMOTION_KEYS, (u) => referenced.add(u));
    walkDeviceMap(settings.scene_images as DeviceMap, SCENE_KEYS, (u) => referenced.add(u));
  }

  const todo: string[] = [];
  let alreadyWebp = 0;
  let foreign = 0;
  for (const url of referenced) {
    const key = keyFromUrl(url);
    if (!key) {
      foreign++; // not in our bucket — the Settings guards should make this impossible
      continue;
    }
    if (key.toLowerCase().endsWith(".webp")) {
      alreadyWebp++;
      continue;
    }
    todo.push(url);
  }
  todo.sort();

  console.log(
    `${referenced.size} referenced asset(s): ${todo.length} to convert, ` +
      `${alreadyWebp} already WebP${foreign ? `, ${foreign} not in the bucket (skipped)` : ""}\n`,
  );
  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // ── Convert ──────────────────────────────────────────────────────────────
  const moved = new Map<string, string>(); // old public URL → new public URL
  const byHash = new Map<string, string>(); // source sha1 → new public URL
  let totalIn = 0;
  let totalOut = 0;
  let reused = 0;
  let failed = 0;

  for (const url of todo) {
    const key = keyFromUrl(url)!;
    const folder = folderFromKey(key);
    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(key);
    if (dlErr || !blob) {
      console.log(`  ${key}  SKIPPED — download failed: ${dlErr?.message ?? "no body"}`);
      failed++;
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = createHash("sha1").update(bytes).digest("hex");

    // Byte-identical sources can share one converted file. Off by default:
    // collapsing two rows onto one URL is a real change to what's stored, not
    // just a re-encode, so it stays opt-in.
    if (DEDUPE && byHash.has(hash)) {
      moved.set(url, byHash.get(hash)!);
      reused++;
      totalIn += bytes.length;
      console.log(`  ${key}  → reuses an identical converted file (${kb(bytes.length)} saved)`);
      continue;
    }

    const out = await toWebp(bytes, type, ext, folder);
    if (out.ext !== "webp") {
      console.log(`  ${key}  SKIPPED — encoder could not read it`);
      failed++;
      continue;
    }

    totalIn += bytes.length;
    totalOut += out.bytes.length;
    const pct = (100 - (out.bytes.length / bytes.length) * 100).toFixed(0);
    const newKey = `${folder}/${crypto.randomUUID()}.webp`;

    if (DRY_RUN) {
      console.log(`  ${key}  ${kb(bytes.length)} → ${kb(out.bytes.length)}  (${pct}% smaller)`);
      // Keep the mapping so the dry run can still report the row rewrites.
      moved.set(url, `${url.slice(0, url.indexOf(PUBLIC_MARKER) + PUBLIC_MARKER.length)}${newKey}`);
      byHash.set(hash, moved.get(url)!);
      continue;
    }

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(newKey, out.bytes, {
      contentType: out.contentType,
      cacheControl: CACHE_CONTROL,
      upsert: false,
    });
    if (upErr) {
      console.log(`  ${key}  SKIPPED — upload failed: ${upErr.message}`);
      failed++;
      continue;
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(newKey);
    moved.set(url, pub.publicUrl);
    byHash.set(hash, pub.publicUrl);
    console.log(`  ${key}  ${kb(bytes.length)} → ${kb(out.bytes.length)}  (${pct}% smaller)`);
  }

  // ── Repoint the rows ─────────────────────────────────────────────────────
  let rowsUpdated = 0;

  for (const it of items ?? []) {
    const next = it.thumb_url ? moved.get(it.thumb_url as string) : undefined;
    if (!next) continue;
    rowsUpdated++;
    if (DRY_RUN) continue;
    const { error } = await supabase.from("menu_items").update({ thumb_url: next }).eq("id", it.id);
    if (error) throw new Error(`menu_items ${it.id} update failed: ${error.message}`);
  }

  let settingsTouched = false;
  if (settings) {
    const emotion_images = rewriteDeviceMap(settings.emotion_images as DeviceMap, EMOTION_KEYS, moved);
    const scene_images = rewriteDeviceMap(settings.scene_images as DeviceMap, SCENE_KEYS, moved);
    settingsTouched =
      JSON.stringify(emotion_images) !== JSON.stringify(settings.emotion_images) ||
      JSON.stringify(scene_images) !== JSON.stringify(settings.scene_images);
    if (settingsTouched && !DRY_RUN) {
      const { error } = await supabase
        .from("cafe_settings")
        .update({ emotion_images, scene_images })
        .eq("id", true);
      if (error) throw new Error(`cafe_settings update failed: ${error.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const converted = moved.size - reused;
  console.log(`\n${converted} file(s) converted${reused ? `, ${reused} deduped` : ""}${failed ? `, ${failed} failed` : ""}`);
  if (totalOut > 0) {
    console.log(`Bytes served: ${kb(totalIn)} → ${kb(totalOut)}  (${(100 - (totalOut / totalIn) * 100).toFixed(0)}% smaller)`);
  }
  console.log(`Rows repointed: ${rowsUpdated} menu_items${settingsTouched ? " + cafe_settings" : ""}`);

  // Surface the dedupe opportunity even when it isn't enabled — six treat
  // cards pointing at six copies of one picture is six downloads.
  if (!DEDUPE) {
    const dupes = todo.length - new Set([...byHash.keys()]).size;
    if (dupes > 0) {
      console.log(`\nNote: ${dupes} of these are byte-identical to another. Re-run with --dedupe to collapse them.`);
    }
  }

  console.log(
    DRY_RUN
      ? "\nDRY RUN — nothing was written."
      : "\nDone. The original files are still in the bucket; delete them by hand once you're happy.",
  );
}

main().catch((err) => {
  console.error("\nAsset backfill failed:", err);
  process.exit(1);
});
