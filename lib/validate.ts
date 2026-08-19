import { CURRENCIES, isCurrency, type Currency } from "./money";

// Strips HTML tags and collapses whitespace. Not a full sanitizer — good
// enough for "never let raw HTML reach Stripe metadata", which is all we
// need since nothing here is rendered as HTML server-side.
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

export function clampString(input: string, maxLen: number): string {
  return input.slice(0, maxLen);
}

export type PaymentMethod = "promptpay" | "card";

export type ValidatedOrder = {
  name: string;
  amount: number; // major units, respecting the currency's decimals
  currency: Currency;
  method: PaymentMethod;
  message: string;
  showOnScreen: boolean;
  email: string; // required for PromptPay; may be "" for card (collected client-side)
  itemId: string | null; // selected treat's menu_items.id, if any — null on a custom amount
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateOrderInput(body: unknown): { ok: true; data: ValidatedOrder } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  // Content moderation (masking/holding/blocking flagged words) happens later,
  // in lib/moderation.ts — this chokepoint only sanitizes and clamps.
  const rawName = typeof b.name === "string" ? b.name : "";
  const name = clampString(stripHtml(rawName), 30) || "Anonymous";

  // Currency first — it governs the amount range and the allowed method.
  const currency: Currency = isCurrency(b.currency) ? b.currency : "thb";
  const cfg = CURRENCIES[currency];

  // PromptPay only works in THB; anything else is forced to card.
  const requestedMethod: PaymentMethod = b.method === "card" ? "card" : "promptpay";
  const method: PaymentMethod = currency === "thb" ? requestedMethod : "card";

  const amountNum = Number(b.amount);
  if (!Number.isFinite(amountNum) || amountNum < cfg.min || amountNum > cfg.max) {
    return { ok: false, error: `Amount must be between ${cfg.min} and ${cfg.max} ${currency.toUpperCase()}.` };
  }
  if (cfg.decimals === 0 && !Number.isInteger(amountNum)) {
    return { ok: false, error: `Amount for ${currency.toUpperCase()} must be a whole number.` };
  }
  const amount = cfg.decimals === 0 ? Math.round(amountNum) : Math.round(amountNum * 100) / 100;

  const rawMessage = typeof b.message === "string" ? b.message : "";
  const message = clampString(stripHtml(rawMessage), 250);

  const showOnScreen = b.showOnScreen !== false; // default true

  // Email is required for PromptPay (used for the QR intent's receipt). For
  // card it's optional here — the client passes it and it's validated below if
  // present — because the card branch also accepts it via the receipt path.
  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  let email = "";
  if (method === "promptpay") {
    if (!rawEmail || !EMAIL_RE.test(rawEmail) || rawEmail.length > 100) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    email = rawEmail;
  } else if (rawEmail) {
    if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 100) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    email = rawEmail;
  }

  // Looked up server-side against menu_items; an unrecognized or stale id just
  // means no item snapshot gets attached, not a validation failure — a treat
  // that was deleted between page-load and checkout shouldn't block payment.
  const rawItemId = typeof b.itemId === "string" ? b.itemId : "";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const itemId = UUID_RE.test(rawItemId) ? rawItemId : null;

  return { ok: true, data: { name, amount, currency, method, message, showOnScreen, email, itemId } };
}
