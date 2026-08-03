"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeQuestionMark, QrCode, CreditCard } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import type { Appearance, StripeElementsOptionsMode } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { translations, type Lang } from "@/lib/i18n";
import { BRAND_NAME } from "@/lib/brand";
import { LIGHT, DARK, FONT_BODY, type Palette } from "@/lib/theme";
import { useTheme } from "@/app/providers";
import ThemeToggle from "@/components/ThemeToggle";
import SupportersPanel, { type SupportersPanelHandle } from "@/components/SupportersPanel";
import {
  CURRENCIES,
  CURRENCY_ORDER,
  PROMPTPAY_CURRENCY,
  formatAmountValue,
  formatMoney,
  isCurrency,
  toMinorUnits,
  type Currency,
} from "@/lib/money";
import { idempotencyKey } from "@/lib/idempotency";

type Screen = "form" | "pay" | "qr" | "success" | "expired";
type Method = "promptpay" | "card";
type Confirmed = { minor: number; currency: Currency };

const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LS_NAME = "tipperName";
const LS_EMAIL = "tipperEmail";
const LS_METHOD = "tipperMethod";

// Mirrors stripeSecretKey() in lib/stripe.ts: outside production prefer the
// test-mode publishable key so local runs use test mode, and switch on the same
// NODE_ENV signal so the publishable and secret keys are always the same mode.
// NEXT_PUBLIC_* vars are inlined at build time, so this ternary resolves in the
// client bundle.
const PUBLISHABLE_KEY =
  process.env.NODE_ENV === "production"
    ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const stripePromise = loadStripe(PUBLISHABLE_KEY || "");

// The Payment Element renders in a cross-origin iframe and can't read our CSS
// custom properties, so it needs literal colours. Both variants are derived
// from the same palette that generates those CSS variables — see lib/theme.ts.
function stripeAppearance(p: Palette, theme: "flat" | "night"): Appearance {
  return {
    theme,
    variables: {
      colorPrimary: p.sakuraDeep,
      colorText: p.text,
      colorTextSecondary: p.muted,
      colorBackground: p.surface,
      colorDanger: p.danger,
      fontFamily: FONT_BODY,
      borderRadius: "12px",
      spacingUnit: "3px",
    },
    rules: {
      ".Input": { border: `1px solid ${p.border}`, backgroundColor: p.surface2 },
      ".Input:focus": { border: `1px solid ${p.sakuraDeep}`, boxShadow: "none" },
      ".Label": { color: p.sakuraDeep, fontWeight: "500" },
    },
  };
}

const STRIPE_APPEARANCE = stripeAppearance(LIGHT, "flat");
const STRIPE_APPEARANCE_DARK = stripeAppearance(DARK, "night");

const PETAL_PATH = "M8 0C3 2 0 7 0 12c0 4 3 7 8 9 5-2 8-5 8-9 0-5-3-10-8-12z";
const PETALS = [
  { left: "6%", dur: "19s", delay: "0s", dx: "60px", color: "#e8a0b4" },
  { left: "18%", dur: "24s", delay: "-4s", dx: "-40px", color: "#c76f89" },
  { left: "38%", dur: "21s", delay: "-9s", dx: "50px", color: "#e8a0b4" },
  { left: "58%", dur: "17s", delay: "-2s", dx: "-60px", color: "#c76f89" },
  { left: "75%", dur: "23s", delay: "-12s", dx: "30px", color: "#e8a0b4" },
  { left: "90%", dur: "20s", delay: "-6s", dx: "-30px", color: "#c76f89" },
];

// One nonce per payment attempt, reused across retries so a double-submit or a
// retried fetch reuses the existing intent rather than minting a second one.
// randomUUID needs a secure context; plain-http dev falls back to a random hex.
function newNonce(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function rangeLabel(c: Currency): string {
  const cfg = CURRENCIES[c];
  return `${formatAmountValue(cfg.min, c)}–${formatAmountValue(cfg.max, c)} ${c.toUpperCase()}`;
}

function amountValid(n: number, c: Currency): boolean {
  const cfg = CURRENCIES[c];
  if (!Number.isFinite(n) || n < cfg.min || n > cfg.max) return false;
  if (cfg.decimals === 0 && !Number.isInteger(n)) return false;
  return true;
}

// Digits (+ a single decimal point for 2-dp currencies) only. JPY takes whole
// numbers, so no dot can ever land in its field.
function sanitizeAmount(raw: string, c: Currency): string {
  if (CURRENCIES[c].decimals === 0) return raw.replace(/[^0-9]/g, "");
  let v = raw.replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  return v;
}

// ── Card entry: Stripe Payment Element in the deferred flow ────────────────
// The intent is created only when the payer hits Pay (no abandoned intents,
// amount always current). The single email field above pre-fills Stripe, so
// no second email box renders.
function CardForm({
  lang,
  name,
  amount,
  currency,
  message,
  keepSecret,
  email,
  getIdempotencyKey,
  onSaveContact,
  onPaid,
  onEdit,
}: {
  lang: Lang;
  name: string;
  amount: string;
  currency: Currency;
  message: string;
  keepSecret: boolean;
  email: string;
  getIdempotencyKey: () => string;
  onSaveContact: () => void;
  onPaid: (piId: string, confirmed: Confirmed) => void;
  onEdit: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = translations[lang];

  const payLabel = t.cardPayBtn(formatMoney(toMinorUnits(Number(amount) || 0, currency), currency));

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!stripe || !elements) return;
    if (!EMAIL_RE.test(email.trim())) {
      setError(t.emailError);
      return;
    }
    setPaying(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || t.cardError);
      setPaying(false);
      return;
    }

    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          amount: Number(amount),
          currency,
          message,
          showOnScreen: !keepSecret,
          email,
          method: "card",
          idempotencyKey: getIdempotencyKey(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        setError(data.error || t.cardError);
        setPaying(false);
        return;
      }

      onSaveContact();

      // Stash the context so a 3-D Secure redirect (which reloads the page and
      // wipes React state) can rebuild the success screen + preview on return.
      try {
        sessionStorage.setItem(
          `tip:${data.paymentIntentId}`,
          JSON.stringify({ name, amount, currency, message, keepSecret })
        );
      } catch {
        /* sessionStorage unavailable — non-fatal */
      }

      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: data.clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/?pi=${data.paymentIntentId}`,
          // Required because we hid the email field (fields.billingDetails.email
          // = "never"); Stripe needs the value supplied here instead.
          payment_method_data: { billing_details: { email } },
        },
        redirect: "if_required",
      });

      if (confirmError) {
        setError(confirmError.message || t.cardError);
        setPaying(false);
        return;
      }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        onPaid(data.paymentIntentId, { minor: toMinorUnits(Number(amount), currency), currency });
        return;
      }
      setError(t.cardError);
      setPaying(false);
    } catch (err) {
      console.error(err);
      setError(t.cardError);
      setPaying(false);
    }
  }

  return (
    <form onSubmit={handlePay} className="card-form">
      <PaymentElement
        options={{
          defaultValues: { billingDetails: { email } },
          fields: { billingDetails: { email: "never" } },
        }}
      />
      {error && <p className="error-text" style={{ margin: "12px 0 0" }}>{error}</p>}
      <button type="submit" disabled={paying || !stripe} style={{ marginTop: 16 }}>
        {paying ? t.cardProcessing : payLabel}
      </button>
      <button type="button" className="back-link" onClick={onEdit}>
        {t.editMessageLink}
      </button>
    </form>
  );
}

export default function Page() {
  const [lang, setLang] = useState<Lang>("th");
  const t = translations[lang];
  const { theme } = useTheme();

  const [screen, setScreen] = useState<Screen>("form");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [email, setEmail] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [emailHintOpen, setEmailHintOpen] = useState(false);
  const [foreignHintOpen, setForeignHintOpen] = useState(false);
  const [secretHintOpen, setSecretHintOpen] = useState(false);
  const nameBeforeAnon = useRef("");

  const [currency, setCurrency] = useState<Currency>("thb");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [keepSecret, setKeepSecret] = useState(false);

  const [method, setMethod] = useState<Method>("promptpay");
  const [methodRemembered, setMethodRemembered] = useState(false);

  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_MS / 1000);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supportersPanelRef = useRef<SupportersPanelHandle>(null);

  // Every path to the success screen should also nudge the supporters panel
  // to refetch, so the visitor's own tip shows up in Recent without a poll.
  function announceSuccess() {
    setScreen("success");
    supportersPanelRef.current?.refresh();
  }

  // Held for the life of one payment attempt. Cleared whenever the payer goes
  // back to edit (new payload ⇒ must be a genuinely new intent) or lands on
  // success, so the next tip never reuses a spent nonce. The actual key sent to
  // Stripe also hashes the current payload (see getIdempotencyKey below), so a
  // mid-attempt edit (email, method, ...) mints a fresh key even without an
  // explicit clear here.
  const attemptNonceRef = useRef<string>("");
  function getIdempotencyKey() {
    if (!attemptNonceRef.current) attemptNonceRef.current = newNonce();
    return idempotencyKey(attemptNonceRef.current, [
      name,
      Number(amount),
      currency,
      method,
      message,
      keepSecret,
      email,
    ]);
  }

  const presets = CURRENCIES[currency].presets;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // layout.tsx is a server component and can't see this client-side toggle, so
  // the document language is synced here instead — screen readers pick the
  // wrong voice for Thai copy when <html lang> is stuck on "en".
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Prefill name + email + last method from a previous visit (this device only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedName = window.localStorage.getItem(LS_NAME) ?? "";
      const savedEmail = window.localStorage.getItem(LS_EMAIL) ?? "";
      const savedMethod = window.localStorage.getItem(LS_METHOD);
      // One-time correction from localStorage (a browser-only source), not
      // derived state — must run post-mount so SSR and the first paint agree
      // before this client-only prefill lands.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (savedName) setName(savedName);
      if (savedEmail) setEmail(savedEmail);
      if (savedName || savedEmail) setPrefilled(true);
      // Remembered method only applies to THB (default currency); a foreign
      // currency is forced to card anyway.
      if (savedMethod === "card") {
        setMethod("card");
        setMethodRemembered(true);
      } else if (savedMethod === "promptpay") {
        setMethodRemembered(true);
      }
    } catch {
      /* localStorage unavailable — no prefill */
    }
  }, []);

  // Handle the 3-D Secure return: rebuild state from sessionStorage, confirm
  // the status once, and land on success (or back on the payment step).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const pi = params.get("pi") || params.get("payment_intent");
    if (!pi) return;

    let stashed: Record<string, unknown> | null = null;
    try {
      const raw = sessionStorage.getItem(`tip:${pi}`);
      if (raw) stashed = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    if (stashed) {
      // One-time rebuild from sessionStorage after the 3-D Secure redirect
      // (an external system), not derived state — genuinely a mount-time
      // effect, not something a lazy initializer could replace since it
      // depends on the URL's `pi`/`payment_intent` param read above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(String(stashed.name ?? ""));
      setAmount(String(stashed.amount ?? ""));
      if (isCurrency(stashed.currency)) setCurrency(stashed.currency);
      setMessage(String(stashed.message ?? ""));
      setKeepSecret(Boolean(stashed.keepSecret));
      setMethod("card");
    }

    (async () => {
      try {
        const res = await fetch(`/api/check-status?id=${pi}`);
        const data = await res.json();
        if (data.status === "SUCCESS") {
          setPaymentIntentId(pi);
          if (stashed && isCurrency(stashed.currency)) {
            setConfirmed({ minor: toMinorUnits(Number(stashed.amount), stashed.currency), currency: stashed.currency });
          }
          announceSuccess();
        } else {
          setScreen("pay");
          setFormError(t.cardError);
        }
      } catch {
        setScreen("pay");
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Celebratory one-shot petal burst when the tip succeeds.
  useEffect(() => {
    if (screen !== "success") return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const burstColors = ["#e8a0b4", "#c76f89", "#f2c4ce"];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 3;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < 16; i++) {
      timers.push(
        setTimeout(() => {
          const p = document.createElement("div");
          p.className = "burst-petal";
          const sz = 9 + Math.random() * 9;
          const tx = (Math.random() - 0.5) * 320;
          const ty = -(40 + Math.random() * 220);
          const tr = (Math.random() - 0.5) * 620 + "deg";
          const dur = 1.8 + Math.random() * 1.4;
          const col = burstColors[Math.floor(Math.random() * burstColors.length)];
          p.style.cssText = `left:${cx + (Math.random() - 0.5) * 140}px;top:${cy}px;--tx:${tx}px;--ty:${ty}px;--tr:${tr};animation-duration:${dur}s;`;
          p.innerHTML = `<svg width="${sz}" height="${sz}" viewBox="0 0 16 21"><path d="${PETAL_PATH}" fill="${col}"/></svg>`;
          document.body.appendChild(p);
          setTimeout(() => p.remove(), dur * 1000 + 200);
        }, i * 55 + Math.random() * 60)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [screen]);

  function handleAnonToggle(checked: boolean) {
    setIsAnonymous(checked);
    if (checked) {
      nameBeforeAnon.current = name;
      setName("");
    } else {
      setName(nameBeforeAnon.current);
    }
  }

  function clearSaved() {
    try {
      window.localStorage.removeItem(LS_NAME);
      window.localStorage.removeItem(LS_EMAIL);
      window.localStorage.removeItem(LS_METHOD);
    } catch {
      /* ignore */
    }
    setName("");
    setEmail("");
    setPrefilled(false);
    setMethodRemembered(false);
  }

  function saveContact() {
    try {
      window.localStorage.setItem(LS_EMAIL, email.trim());
      if (name.trim()) window.localStorage.setItem(LS_NAME, name.trim());
      window.localStorage.setItem(LS_METHOD, method);
    } catch {
      /* non-fatal */
    }
  }

  function changeCurrency(c: Currency) {
    setCurrency(c);
    setAmount((prev) => sanitizeAmount(prev, c));
    if (c !== PROMPTPAY_CURRENCY) setMethod("card"); // PromptPay is THB-only
  }

  function handleAmountChange(raw: string) {
    setAmount(sanitizeAmount(raw, currency));
  }

  function selectMethod(m: Method) {
    if (m === "promptpay" && currency !== PROMPTPAY_CURRENCY) return; // locked
    setMethod(m);
  }

  // Page 1 → Page 2. No network; just validate the amount for this currency.
  function goToPayment(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const n = Number(amount);
    if (!amountValid(n, currency)) {
      setFormError(t.amountError(rangeLabel(currency)));
      return;
    }
    setScreen("pay");
  }

  // PromptPay: create + confirm the QR intent, then poll.
  async function submitPromptPay() {
    setFormError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFormError(t.emailError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          amount: Number(amount),
          currency: "thb",
          message,
          showOnScreen: !keepSecret,
          email,
          method: "promptpay",
          idempotencyKey: getIdempotencyKey(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || t.genericError);
        setSubmitting(false);
        return;
      }
      saveContact();
      setQrImageUrl(data.qrImageUrl);
      setHostedUrl(data.hostedInstructionsUrl || null);
      setPaymentIntentId(data.paymentIntentId);
      setConfirmed({ minor: toMinorUnits(Number(amount), "thb"), currency: "thb" });
      setSecondsLeft(TIMEOUT_MS / 1000);
      setScreen("qr");
      startPolling(data.paymentIntentId);
      startCountdown();
    } catch (err) {
      console.error(err);
      setFormError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  function onCardPaid(piId: string, c: Confirmed) {
    setPaymentIntentId(piId);
    setConfirmed(c);
    attemptNonceRef.current = "";
    announceSuccess();
  }

  // Returning to the form means the payload can change, so the attempt is over
  // and its idempotency key must not survive into the next intent.
  function editFromPayment() {
    attemptNonceRef.current = "";
    setScreen("form");
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/check-status?id=${id}`);
        const data = await res.json();
        // SUCCESS is our own state, not Stripe's string. statusFromStripe folds
        // both `succeeded` and `processing` into it — PromptPay hands off to the
        // bank and sits in `processing` until settlement, and treating that as
        // unpaid let a genuinely-paid tip run out the 10-minute clock.
        if (data.status === "SUCCESS") {
          stopTimers();
          attemptNonceRef.current = "";
          announceSuccess();
        }
      } catch (err) {
        console.error("poll error", err);
      }
    }, POLL_MS);
  }

  function startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const startedAt = Date.now();
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((TIMEOUT_MS - (Date.now() - startedAt)) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        stopTimers();
        setScreen((current) => (current === "qr" ? "expired" : current));
      }
    }, 1000);
  }

  function stopTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }

  function backToForm() {
    stopTimers();
    setScreen("form");
    setQrImageUrl(null);
    setPaymentIntentId(null);
    setFormError(null);
    attemptNonceRef.current = "";
  }

  const elementsOptions: StripeElementsOptionsMode = useMemo(
    () => ({
      mode: "payment",
      amount: toMinorUnits(Number(amount) || CURRENCIES[currency].min, currency),
      currency,
      paymentMethodTypes: ["card"],
      appearance: theme === "dark" ? STRIPE_APPEARANCE_DARK : STRIPE_APPEARANCE,
      locale: lang,
    }),
    [amount, currency, lang, theme]
  );

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const chargeMoney = confirmed
    ? formatMoney(confirmed.minor, confirmed.currency)
    : formatMoney(toMinorUnits(Number(amount) || 0, currency), currency);

  return (
    <div className="stage">
    <div className="page">
      <ThemeToggle />
      <div className="lang-toggle">
        <button type="button" className={lang === "th" ? "active" : ""} onClick={() => setLang("th")}>
          TH
        </button>
        <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
          EN
        </button>
      </div>

      <div className="petals" aria-hidden="true">
        {PETALS.map((p, i) => (
          <div
            key={i}
            className="petal"
            style={
              {
                left: p.left,
                animationDuration: p.dur,
                animationDelay: p.delay,
                "--drift-x": p.dx,
              } as React.CSSProperties
            }
          >
            <svg width={10 + (i % 3) * 3} height={10 + (i % 3) * 3} viewBox="0 0 16 21">
              <path d={PETAL_PATH} fill={p.color} />
            </svg>
          </div>
        ))}
      </div>

      <div className="card">
        {screen === "form" && (
          <>
            <svg className="branch" width="120" height="34" viewBox="0 0 120 34" aria-hidden="true">
              <path d="M5 30 Q30 8 60 15 T115 5" stroke="#c76f89" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="22" cy="17" r="2.6" fill="#e8a0b4" />
              <circle cx="17" cy="13" r="2" fill="#e8a0b4" />
              <circle cx="27" cy="11" r="2" fill="#e8a0b4" />
              <circle cx="63" cy="11" r="2.6" fill="#e8a0b4" />
              <circle cx="68" cy="7" r="2" fill="#e8a0b4" />
              <circle cx="95" cy="7" r="2.6" fill="#e8a0b4" />
              <circle cx="100" cy="3" r="2" fill="#e8a0b4" />
            </svg>
            <p className="eyebrow">{BRAND_NAME}</p>
            <h1>{t.title}</h1>
            <p className="subtitle">{t.subtitle}</p>

            <form onSubmit={goToPayment}>
              <div className="field">
                <label htmlFor="name">{t.nameLabel}</label>
                <input
                  id="name"
                  type="text"
                  maxLength={30}
                  value={name}
                  disabled={isAnonymous}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                />
              </div>
              <div className="anon-row">
                <input id="anon" type="checkbox" checked={isAnonymous} onChange={(e) => handleAnonToggle(e.target.checked)} />
                <label htmlFor="anon">{t.anonLabel}</label>
                {prefilled && (
                  <button type="button" className="clear-saved" onClick={clearSaved}>
                    {t.clearSaved}
                  </button>
                )}
              </div>

              <div className="field">
                <div className="label-row">
                  <label htmlFor="amount">{t.amountLabel}</label>
                  {currency !== PROMPTPAY_CURRENCY && (
                    <span className="foreign-tag-wrap">
                      <span className="foreign-tag">{t.foreignCardTag}</span>
                      <span className="hint-tooltip-wrap">
                        <button
                          type="button"
                          className="hint-icon-btn"
                          aria-label={t.foreignCardOnly}
                          aria-expanded={foreignHintOpen}
                          onClick={() => setForeignHintOpen((v) => !v)}
                          onBlur={() => setForeignHintOpen(false)}
                        >
                          <BadgeQuestionMark size={16} strokeWidth={2} />
                        </button>
                        {foreignHintOpen && <span className="hint-tooltip">{t.foreignCardOnly}</span>}
                      </span>
                    </span>
                  )}
                </div>
                <div className="amount-row">
                  <input
                    id="amount"
                    type="text"
                    inputMode={CURRENCIES[currency].decimals === 0 ? "numeric" : "decimal"}
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder={formatAmountValue(presets[2], currency)}
                  />
                  <select
                    className="currency-select"
                    aria-label={t.currencyLabel}
                    value={currency}
                    onChange={(e) => changeCurrency(e.target.value as Currency)}
                  >
                    {CURRENCY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {CURRENCIES[c].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="amount-presets">
                  {presets.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      className={`preset-chip${Number(amount) === preset ? " active" : ""}`}
                      onClick={() => setAmount(String(preset))}
                    >
                      {CURRENCIES[currency].symbol}
                      {formatAmountValue(preset, currency)}
                    </button>
                  ))}
                </div>
                {formError ? (
                  <p className="field-hint error-hint">{formError}</p>
                ) : (
                  <p className="field-hint">{t.amountHint(rangeLabel(currency))}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="message">{t.messageLabel}</label>
                <textarea
                  id="message"
                  maxLength={250}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.messagePlaceholder}
                />
                <div className="char-count">{message.length}/250</div>
              </div>

              <div className="checkbox-row">
                <input id="keepSecret" type="checkbox" checked={keepSecret} onChange={(e) => setKeepSecret(e.target.checked)} />
                <label htmlFor="keepSecret">{t.keepSecretLabel}</label>
                <span className="hint-tooltip-wrap">
                  <button
                    type="button"
                    className="hint-icon-btn"
                    aria-label={t.keepSecretHint}
                    aria-expanded={secretHintOpen}
                    onClick={() => setSecretHintOpen((v) => !v)}
                    onBlur={() => setSecretHintOpen(false)}
                  >
                    <BadgeQuestionMark size={16} strokeWidth={2} />
                  </button>
                  {secretHintOpen && <span className="hint-tooltip">{t.keepSecretHint}</span>}
                </span>
              </div>

              <button type="submit">{t.continueToPayment}</button>
            </form>
          </>
        )}

        {screen === "pay" && (
          <>
            <p className="eyebrow">{BRAND_NAME}</p>
            <h1>{t.paymentTitle}</h1>
            <p className="subtitle">{t.chargeNote(chargeMoney)}</p>

            <div className="field">
              <div className="label-row">
                <label>{t.methodLabel}</label>
                {methodRemembered && currency === PROMPTPAY_CURRENCY && (
                  <span className="remembered-tag">{t.methodRemembered}</span>
                )}
              </div>
              <div className="method-toggle">
                <button
                  type="button"
                  className={`method-btn${method === "promptpay" ? " active" : ""}`}
                  disabled={currency !== PROMPTPAY_CURRENCY}
                  onClick={() => selectMethod("promptpay")}
                >
                  <QrCode className="method-icon" size={22} strokeWidth={2} />
                  <span className="method-title">{t.methodPromptPay}</span>
                  <span className="method-sub">{t.methodPromptPaySub}</span>
                </button>
                <button
                  type="button"
                  className={`method-btn${method === "card" ? " active" : ""}`}
                  onClick={() => selectMethod("card")}
                >
                  <CreditCard className="method-icon" size={22} strokeWidth={2} />
                  <span className="method-title">{t.methodCard}</span>
                  <span className="method-sub">{t.methodCardSub}</span>
                </button>
              </div>
              {currency !== PROMPTPAY_CURRENCY && <p className="method-hint">{t.promptpayThbOnly}</p>}
            </div>

            <div className="field">
              <div className="label-row">
                <label htmlFor="email">{t.emailReceiptLabel}</label>
                <span className="hint-tooltip-wrap">
                  <button
                    type="button"
                    className="hint-icon-btn"
                    aria-label={t.emailHint}
                    aria-expanded={emailHintOpen}
                    onClick={() => setEmailHintOpen((v) => !v)}
                    onBlur={() => setEmailHintOpen(false)}
                  >
                    <BadgeQuestionMark size={16} strokeWidth={2} />
                  </button>
                  {emailHintOpen && <span className="hint-tooltip">{t.emailHint}</span>}
                </span>
              </div>
              <input
                id="email"
                type="email"
                maxLength={100}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {method === "promptpay" ? (
              <>
                {formError && <p className="error-text">{formError}</p>}
                <button type="button" disabled={submitting} onClick={submitPromptPay}>
                  {submitting ? t.submittingBtn : t.showQrBtn}
                </button>
                <button type="button" className="back-link" onClick={editFromPayment}>
                  {t.editMessageLink}
                </button>
              </>
            ) : (
              <>
                {/* A failed 3-D Secure return sets formError on the way back in;
                    without this slot the card path swallowed it silently. */}
                {formError && <p className="error-text">{formError}</p>}
                <Elements
                  // amount must stay in the key: elementsOptions.amount is baked
                  // in at mount and Stripe ignores option changes without an
                  // elements.update() call. theme/lang are here so a toggle on
                  // this screen actually restyles the card field.
                  key={`${currency}-${amount}-${theme}-${lang}`}
                  stripe={stripePromise}
                  options={elementsOptions}
                >
                  <CardForm
                    lang={lang}
                    name={name}
                    amount={amount}
                    currency={currency}
                    message={message}
                    keepSecret={keepSecret}
                    email={email}
                    getIdempotencyKey={getIdempotencyKey}
                    onSaveContact={saveContact}
                    onPaid={onCardPaid}
                    onEdit={editFromPayment}
                  />
                </Elements>
              </>
            )}
          </>
        )}

        {screen === "qr" && qrImageUrl && (
          <div className="qr-wrap">
            <h1 className="qr-title">{t.qrEyebrow}</h1>
            <div className="waiting-row" role="status" aria-live="polite">
              <span className="waiting-dots" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
              <span className="waiting-text">{t.qrWaiting}</span>
            </div>
            <p className="qr-autodetect">{t.qrAutoDetect}</p>
            <p className={`timer${secondsLeft <= 60 ? " urgent" : ""}`}>
              {t.timerLabel} {mm}:{ss}
            </p>
            <div className="qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImageUrl} alt={t.qrAlt} />
            </div>
            <p className="qr-amount">{confirmed ? formatMoney(confirmed.minor, confirmed.currency) : ""}</p>
            <p className="qr-help">{t.qrHelp1}</p>
            {hostedUrl && (
              <p className="qr-help">
                <a href={hostedUrl} target="_blank" rel="noreferrer">
                  {t.qrHelp2}
                </a>
              </p>
            )}
            <button type="button" className="back-link" onClick={() => setScreen("pay")}>
              {t.backLink}
            </button>
          </div>
        )}

        {screen === "success" && (
          <div className="qr-wrap">
            <div className="status-icon">
              <svg width="40" height="40" viewBox="0 0 16 21">
                <path d={PETAL_PATH} fill="#e8a0b4" />
              </svg>
            </div>
            <h1>{t.successTitle}</h1>
            <p className="subtitle">
              {keepSecret
                ? t.successSubtitleHidden
                : confirmed
                ? t.successSubtitleWithAmount(formatMoney(confirmed.minor, confirmed.currency))
                : t.successSubtitleNoAmount}
            </p>

            {!keepSecret && confirmed && (
              <div className="preview-block">
                <p className="preview-label">{t.successPreviewLabel}</p>
                <div className="preview-card">
                  <div className="preview-pill">
                    <span className="preview-from">{t.previewFrom}</span>
                    <span className="preview-name">{name.trim() || "Anonymous"}</span>
                  </div>
                  <div className="preview-body">
                    <span className="preview-flower" aria-hidden="true">🌸</span>
                    <div className="preview-inner">
                      <p className="preview-amount">
                        {formatMoney(confirmed.minor, confirmed.currency)}{" "}
                        <span>{CURRENCIES[confirmed.currency].spoken[lang]}</span>
                      </p>
                      {message.trim() && <p className="preview-msg">{message.trim()}</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button type="button" onClick={backToForm}>
              {t.sendAnotherBtn}
            </button>
          </div>
        )}

        {screen === "expired" && (
          <div className="qr-wrap">
            <div className="status-icon" style={{ fontSize: "38px" }}>⏳</div>
            <h1>{t.expiredTitle}</h1>
            <p className="subtitle">{t.expiredSubtitle}</p>
            <button type="button" onClick={backToForm}>
              {t.tryAgainBtn}
            </button>
          </div>
        )}

      </div>

      <p className="footer-note">
        {t.footer}
        {paymentIntentId && screen !== "form" ? ` · Ref: ${paymentIntentId.slice(-8)}` : ""}
      </p>
    </div>
    <SupportersPanel ref={supportersPanelRef} lang={lang} />
    </div>
  );
}
