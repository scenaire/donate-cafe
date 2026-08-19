import { NextRequest, NextResponse } from "next/server";
import { isValidWidgetToken } from "@/lib/widget-token";

// Only these ever reach the outbound URL. `lang` used to be interpolated raw,
// so a value like `th&client=x` could append arbitrary query params to the
// Google request — an allowlist is the fix, not escaping.
const LANGS = new Set(["th", "en"]);

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!(await isValidWidgetToken(token))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const text = req.nextUrl.searchParams.get("text") || "";
  const lang = req.nextUrl.searchParams.get("lang") || "th";

  if (!text.trim()) {
    return new NextResponse(null, { status: 400 });
  }
  if (!LANGS.has(lang)) {
    return new NextResponse(null, { status: 400 });
  }

  const url =
    `https://translate.googleapis.com/translate_tts?ie=UTF-8` +
    `&q=${encodeURIComponent(text.slice(0, 180))}` +
    `&tl=${lang}&client=gtx`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return new NextResponse(null, { status: 502 });

    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
