import { NextRequest, NextResponse } from "next/server";

// Proxies Stripe's hosted PromptPay QR PNG so the browser can download it
// same-origin — qr.stripe.com doesn't send Access-Control-Allow-Origin, so a
// direct client-side fetch is blocked by CORS on every browser. Locked to
// this exact host to avoid turning the route into an open SSRF fetcher.
const ALLOWED_HOST = "qr.stripe.com";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") || "";

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const res = await fetch(target.toString());
    if (!res.ok || !res.body) return new NextResponse(null, { status: 502 });

    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/png",
        "Content-Disposition": 'attachment; filename="promptpay-qr.png"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
