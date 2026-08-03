// Single source of truth for currency behaviour, shared by the checkout form,
// the API routes, the alert overlay, and the dashboard. THB/USD/EUR are
// two-decimal ("×100 minor units"); JPY is zero-decimal (¥500 → 500, not
// 50000), so every amount conversion MUST go through here — never hardcode ×100.

export type Currency = "thb" | "usd" | "eur" | "jpy";

type CurrencyConfig = {
  symbol: string;
  decimals: 0 | 2;
  min: number;
  max: number;
  presets: number[];
  label: string; // shown in the currency picker
  spoken: { th: string; en: string }; // unit word for TTS ("baht", "dollars", …)
};

export const CURRENCIES: Record<Currency, CurrencyConfig> = {
  thb: { symbol: "฿", decimals: 2, min: 20, max: 50000, presets: [20, 50, 100, 300, 500], label: "THB", spoken: { th: "บาท", en: "baht" } },
  usd: { symbol: "$", decimals: 2, min: 1, max: 1500, presets: [1, 3, 5, 10, 20], label: "USD", spoken: { th: "ดอลลาร์", en: "dollars" } },
  eur: { symbol: "€", decimals: 2, min: 1, max: 1500, presets: [1, 3, 5, 10, 20], label: "EUR", spoken: { th: "ยูโร", en: "euros" } },
  jpy: { symbol: "¥", decimals: 0, min: 100, max: 200000, presets: [100, 300, 500, 1000, 3000], label: "JPY", spoken: { th: "เยน", en: "yen" } },
};

// Display order in the picker — THB first (home currency).
export const CURRENCY_ORDER: Currency[] = ["thb", "usd", "eur", "jpy"];

// PromptPay is only available in this currency; everything else is card-only.
export const PROMPTPAY_CURRENCY: Currency = "thb";

export function isCurrency(x: unknown): x is Currency {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, x);
}

// Major units (what the user types) → Stripe's smallest unit.
export function toMinorUnits(amount: number, currency: Currency): number {
  return CURRENCIES[currency].decimals === 0 ? Math.round(amount) : Math.round(amount * 100);
}

// Stripe's smallest unit → major units.
export function fromMinorUnits(minor: number, currency: Currency): number {
  return CURRENCIES[currency].decimals === 0 ? minor : minor / 100;
}

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Format a major-unit value: strip a trailing ".00" but keep meaningful
// decimals (300→"300", 222.22→"222.22"), group thousands, no symbol.
export function formatAmountValue(value: number, currency: Currency): string {
  if (!Number.isFinite(value)) return "0";
  if (CURRENCIES[currency].decimals === 0) return groupThousands(Math.round(value).toString());
  const cents = Math.round((value % 1) * 100);
  const s = cents === 0 ? Math.floor(value).toString() : value.toFixed(2);
  const [int, dec] = s.split(".");
  return groupThousands(int) + (dec ? "." + dec : "");
}

// Full display string with symbol, e.g. "$3", "¥500", "฿100.50".
export function formatMoney(minor: number, currency: Currency): string {
  return CURRENCIES[currency].symbol + formatAmountValue(fromMinorUnits(minor, currency), currency);
}

// Spoken form for TTS, e.g. "300 baht" / "3 dollars" / "500 เยน".
export function spokenAmount(minor: number, currency: Currency, lang: "th" | "en"): string {
  return `${formatAmountValue(fromMinorUnits(minor, currency), currency)} ${CURRENCIES[currency].spoken[lang]}`;
}
