import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { validateOrderInput } from "@/lib/validate";
import { toMinorUnits, type Currency } from "@/lib/money";
import { clientKeyFromForwarded } from "@/lib/ratelimit";
import { snapshotThb, type FxSnapshot } from "@/lib/fx";

// Public endpoint that hits Stripe and writes an orders row on every call —
// PromptPay uses confirm: true, so an unthrottled script can flood the table
// with real QR intents during exactly the window you're streaming. Generous
// enough for a human correcting an amount, tight enough to kill a script.
const RATE_MAX = 10; // requests per IP …
const RATE_WINDOW_SECONDS = 60; // … per minute

// The client sends one key per payment attempt and reuses it across retries, so
// a flaky network or a double-submit reuses the existing intent instead of
// minting a second one. Matters most on the PromptPay path below, where
// `confirm: true` means a duplicate is a fully-formed second QR.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,255}$/;

function idempotencyOptions(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const key = typeof b.idempotencyKey === "string" ? b.idempotencyKey : "";
  return IDEMPOTENCY_KEY_RE.test(key) ? { idempotencyKey: key } : undefined;
}

// Record the order as PENDING the moment Stripe hands us an intent.
//
// Upsert-ignore rather than plain insert: the Stripe idempotency key above
// means a retried request returns the SAME intent id, which would otherwise
// collide on the unique payment_intent_id and turn a successful retry into a
// 500 for the payer.
//
// A failure here is logged but not surfaced. The payment is already live at
// Stripe by this point, so refusing to return the QR would strand a payer whose
// money can still move; /api/sweep and the webhook's "unknown order" warning
// are how a missing row gets noticed.
async function recordOrder(row: {
  payment_intent_id: string;
  customer_name: string;
  message: string;
  amount_minor: number;
  currency: Currency;
  show_on_screen: boolean;
  snapshot: FxSnapshot;
}) {
  const { snapshot, ...rest } = row;
  const { error } = await supabase.from("orders").upsert(
    {
      ...rest,
      message: row.message || null,
      status: "PENDING",
      thb_equivalent_minor: snapshot.thbEquivalentMinor,
      fx_rate_to_thb: snapshot.fxRateToThb,
      fx_source: snapshot.fxSource,
    },
    { onConflict: "payment_intent_id", ignoreDuplicates: true }
  );
  if (error) console.error("Failed to record order", row.payment_intent_id, error.message);
}

export async function POST(req: NextRequest) {
  // Before any parsing or work: reject a flood at the door. Atomic in
  // Postgres via try_consume_rate (supabase/schema.sql) for the same reason
  // try_acquire_sweep is — an in-memory counter is useless across Vercel's
  // isolated lambdas.
  const ip = clientKeyFromForwarded(req.headers.get("x-forwarded-for"), "unknown");
  const { data: allowed, error: rlError } = await supabase.rpc("try_consume_rate", {
    p_key: `cpi:${ip}`,
    p_max: RATE_MAX,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (rlError) {
    // Fail OPEN, deliberately: unlike the sweep throttle (which fails closed
    // with a 500 — nothing time-sensitive is lost by delaying a sweep), this
    // endpoint's job is taking money. A limiter DB blip must not block a
    // paying customer, so a check we couldn't run just lets the request
    // through and logs.
    console.error("Rate-limit check failed", rlError.message);
  } else if (allowed === false) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validated = validateOrderInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { name, amount, currency, method, message, showOnScreen, email } = validated.data;

  const idempotency = idempotencyOptions(body);
  const amountMinor = toMinorUnits(amount, currency);
  // Kicked off alongside the Stripe call below (Promise.all) so freezing the
  // FX snapshot never adds latency to the checkout path — see lib/fx.ts.
  const snapshotPromise = snapshotThb(amountMinor, currency);
  const metadata = {
    customer_name: name,
    message,
    show_on_screen: showOnScreen ? "true" : "false",
    amount_display: String(amount),
    currency,
  };

  try {
    // ── Card: deferred flow ──────────────────────────────────────────────
    // Create an UNCONFIRMED intent and hand the browser its client_secret;
    // the Payment Element confirms it client-side (card data never touches us).
    // Called only at "Pay" time, so no abandoned intents pile up.
    if (method === "card") {
      const [intent, snapshot] = await Promise.all([
        stripe.paymentIntents.create(
          {
            amount: amountMinor,
            currency,
            payment_method_types: ["card"],
            ...(email ? { receipt_email: email } : {}),
            metadata,
          },
          idempotency
        ),
        snapshotPromise,
      ]);

      await recordOrder({
        payment_intent_id: intent.id,
        customer_name: name,
        message,
        amount_minor: amountMinor,
        currency,
        show_on_screen: showOnScreen,
        snapshot,
      });

      return NextResponse.json({
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amount,
        currency,
      });
    }

    // ── PromptPay: server-confirmed QR flow (THB only) ───────────────────
    const [intent, snapshot] = await Promise.all([
      stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency,
          payment_method_types: ["promptpay"],
          payment_method_data: {
            type: "promptpay",
            billing_details: { email },
          },
          confirm: true,
          metadata,
        },
        idempotency
      ),
      snapshotPromise,
    ]);

    await recordOrder({
      payment_intent_id: intent.id,
      customer_name: name,
      message,
      amount_minor: amountMinor,
      currency,
      show_on_screen: showOnScreen,
      snapshot,
    });

    const qr = intent.next_action?.promptpay_display_qr_code;
    if (!qr) {
      console.error("No QR returned for PaymentIntent", intent.id, intent.status);
      return NextResponse.json(
        { error: "Could not generate a QR code. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      paymentIntentId: intent.id,
      qrImageUrl: qr.image_url_png,
      hostedInstructionsUrl: qr.hosted_instructions_url,
      amount,
      currency,
      expiresInSeconds: 600,
    });
  } catch (err) {
    console.error("Failed to create PaymentIntent", err);
    return NextResponse.json(
      { error: "Something went wrong setting up payment. Please try again." },
      { status: 500 }
    );
  }
}
