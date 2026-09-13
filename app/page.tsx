"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QrCode, CreditCard, Download, Check } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import type { Appearance, StripeElementsOptionsMode } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { translations, type Lang } from "@/lib/i18n";
import { LIGHT, FONT_BODY, FONT_LABEL, type Palette } from "@/lib/theme";
import { toMinorUnits, formatMoney, isCurrency, CURRENCIES as MONEY_CFG, PROMPTPAY_CURRENCY, type Currency } from "@/lib/money";
import { idempotencyKey } from "@/lib/idempotency";
import { STREAMER_NAME } from "@/lib/brand";
import {
  MENU,
  GOAL,
  FLOWER_LINE,
  TTS_THRESHOLD_THB,
  CURRENCIES,
  CUR_BY_CODE,
  CAFE_COPY,
  IDLE_LINES,
  SHARE_HANDLE,
  fmtDisplay,
  toDisplay,
  displayToThb,
  baht,
  fmtStamp,
  fmtExpiry,
  fmtGoalDeadline,
  relTime,
  type DisplayCurrency,
  type RecentSupporter,
  type Treat,
  type MenuItemDto,
  type CafeConfigDto,
  type Emotion,
  type Scene,
  type DeviceEmotionImages,
  type DeviceSceneImages,
  type IdleLine,
  type VoiceTemplate,
  type ConditionTag,
  type WeatherTag,
  type GuestTag,
  PICK_TEMPLATE_DEFAULT,
  THANKS_TEMPLATE_DEFAULT,
  pickIdleLine,
  renderTemplate,
  timeTagForHour,
} from "@/lib/cafe";

const EMPTY_EMOTIONS_ONE = { neutral: null, smile: null, sad: null, sparkle: null };
const EMPTY_SCENES_ONE = { day: null, dusk: null, night: null };
const EMPTY_EMOTIONS: DeviceEmotionImages = { mobile: EMPTY_EMOTIONS_ONE, desktop: EMPTY_EMOTIONS_ONE };
const EMPTY_SCENES: DeviceSceneImages = { mobile: EMPTY_SCENES_ONE, desktop: EMPTY_SCENES_ONE };
// Guest's own local hour decides the backdrop — "the counter art changes with
// the time of day where your guest is, not where you are" (design intent).
function sceneForHour(hour: number): Scene {
  if (hour < 17) return "day";
  if (hour < 21) return "dusk";
  return "night";
}

// Format a supporter amount in the currency it was actually tipped in.
function supporterAmount(minor: number, currency: string): string {
  return isCurrency(currency) ? formatMoney(minor, currency) : "";
}

type Screen = "counter" | "pay" | "receipt";
type Method = "promptpay" | "card";

const POLL_MS = 3000;
const QR_TTL_MS = 10 * 60 * 1000; // mirrors EXPIRE_AFTER_MS in app/api/sweep/route.ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// The desktop card is a fixed 1180px; below this the mobile shell takes over.
const MOBILE_BREAKPOINT = 859;

// ── Boot curtain timings ────────────────────────────────────────────────────
// Every one of these is a ceiling, never a delay: the curtain lifts the moment
// the counter is genuinely ready. They exist so a slow bucket, a blocked font
// or a dead API can't hold a paying guest behind a loading screen.
const BOOT_MAX_MS = 2600; // hard cap — lift regardless of what is still pending
const BOOT_FONT_MS = 800; // pixel fonts; past this, paint with the fallback
const BOOT_ART_MS = 1600; // portrait + backdrop bitmaps
const BOOT_SHOW_MS = 120; // don't paint the curtain at all if we're ready first
const BOOT_FADE_MS = 300; // must match .boot-curtain's transition in globals.css

// Desktop menu grid. Two rows of treats is the most the menu column can hold
// and still stay shorter than the left rail (portrait + message box); past that
// the café-goal card moves out of the menu column and under the order slip.
const MENU_GRID_COLS = 3;
const GOAL_UNDER_MENU_MAX_ROWS = 2;
// Café name shown before /api/cafe-config resolves (and if it never does).
const FALLBACK_CAFE_NAME = "Whispering Rain Café";

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
const TYPE_MS = 32;

const PUBLISHABLE_KEY =
  process.env.NODE_ENV === "production"
    ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = loadStripe(PUBLISHABLE_KEY || "");

// Pixel palette fed to the cross-origin Stripe iframe (can't read CSS vars).
function stripeAppearance(p: Palette): Appearance {
  return {
    theme: "flat",
    variables: {
      colorPrimary: p.sakuraDeep,
      colorText: "#7A3F49",
      colorTextSecondary: p.muted,
      colorBackground: "#FFFFFF",
      colorDanger: p.danger,
      fontFamily: FONT_BODY,
      borderRadius: "0px",
      spacingUnit: "3px",
    },
    rules: {
      ".Input": { border: `3px solid #DBB79A`, backgroundColor: "#FFF" },
      ".Input:focus": { border: `3px solid ${p.sakuraDeep}`, boxShadow: "none" },
      ".Label": {
        color: "#9A6656",
        fontFamily: FONT_LABEL,
        fontWeight: "500",
        fontSize: "9px",
        letterSpacing: ".1em",
        textTransform: "uppercase",
      },
    },
  };
}
const STRIPE_APPEARANCE = stripeAppearance(LIGHT);

function newNonce(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function sanitizeAmount(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  return v.slice(0, 8);
}

// ── shared inline style fragments ───────────────────────────────────────────
const mono = "var(--font-silkscreen), monospace";
const dot = "var(--font-dotgothic), monospace";

// Selected treat "shelf tile" (mobile menu, verbatim from the prototype's itemList).
const TILE_ON_BG = "linear-gradient(180deg, #F9B6CC 0%, #FDD3E0 32%, #FCE6D9 62%, #FFF6E2 100%)";
const TILE_ON_GLOW = "0 0 0 3px #FFF9E6, 0 0 0 6px #9E4B54, 0 0 13px 2px rgba(255,208,130,.4), 0 13px 24px rgba(255,180,90,.38)";
// Placeholder dither for treat thumbnails (until real art) — a visible brown
// diagonal stripe, not the near-flat pale tan used for tiny avatars.
const TREAT_DITHER = "repeating-linear-gradient(135deg,#E7D2B0 0 6px,#C79A6E 6px 12px)";

// Resolves a next/font CSS variable (e.g. "--font-dotgothic") to its generated
// font-family name, for use in a <canvas> `font` string — canvas text can't
// read `var(...)` the way DOM styles can.
function resolveFont(varName: string): string {
  const s = document.createElement("span");
  s.style.fontFamily = `var(${varName})`;
  s.style.position = "absolute";
  s.style.visibility = "hidden";
  document.body.appendChild(s);
  const fam = getComputedStyle(s).fontFamily || "monospace";
  s.remove();
  return fam;
}

// ── Card entry (Stripe Payment Element, deferred flow) ──────────────────────
function CardForm({
  lang, name, amount, currency, displayCur, payLabel, message, keepSecret, email, itemId, getIdempotencyKey, onSaveContact, onPaid,
}: {
  lang: Lang;
  name: string;
  amount: number; // major units, in `currency`
  currency: Currency;
  displayCur: DisplayCurrency; // stashed so the 3-D Secure return restores the picker
  payLabel: string; // formatted "AMOUNT DUE" for the button (matches what's charged)
  message: string;
  keepSecret: boolean;
  email: string;
  itemId: string | null;
  getIdempotencyKey: () => string;
  onSaveContact: () => void;
  onPaid: (piId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = translations[lang];
  const c = CAFE_COPY[lang];

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!stripe || !elements) return;
    if (!EMAIL_RE.test(email.trim())) {
      setError(c.errEmail);
      return;
    }
    setPaying(true);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || c.errCard);
      setPaying(false);
      return;
    }
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, amount, currency, message,
          showOnScreen: !keepSecret, email, method: "card", idempotencyKey: getIdempotencyKey(), itemId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        setError(data.error || c.errCard);
        setPaying(false);
        return;
      }
      onSaveContact();
      try {
        sessionStorage.setItem(`tip:${data.paymentIntentId}`, JSON.stringify({ name, amount, displayCur, message, keepSecret }));
      } catch {
        /* non-fatal */
      }
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: data.clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/?pi=${data.paymentIntentId}`,
          payment_method_data: { billing_details: { email } },
        },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message || c.errCard);
        setPaying(false);
        return;
      }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        onPaid(data.paymentIntentId);
        return;
      }
      setError(c.errCard);
      setPaying(false);
    } catch (err) {
      console.error(err);
      setError(c.errCard);
      setPaying(false);
    }
  }

  return (
    <form onSubmit={handlePay} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ padding: 14, border: "3px solid #DBB79A", background: "#FFF" }}>
        <PaymentElement
          options={{
            layout: { type: "tabs" },
            defaultValues: { billingDetails: { email } },
            fields: { billingDetails: { email: "never" } },
          }}
        />
      </div>
      {error && <div style={errBlock}>{error}</div>}
      <button type="submit" disabled={paying || !stripe} style={ctaBtn}>
        {paying ? t.cardProcessing : c.payCta(payLabel)}
      </button>
    </form>
  );
}

export default function Page() {
  const [lang, setLang] = useState<Lang>("th");
  const c = CAFE_COPY[lang];
  // The PromptPay QR ticket is pinned to English regardless of the page's
  // display language, so a saved/screenshotted copy reads the same for every payer.
  const qc = CAFE_COPY.en;

  // Single route, single component: below MOBILE_BREAKPOINT the page renders the
  // purpose-built mobile shell (sticky top/bottom bars, collapsed portrait band,
  // torn-paper receipt), above it the desktop card. `null` until mounted so the
  // server render and first client render agree (no hydration mismatch/flash).
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  // ── Boot curtain readiness ────────────────────────────────────────────────
  // Four real milestones, in the order they resolve. The curtain's progress bar
  // reads straight off these, so it can never show progress the page hasn't
  // actually made.
  const [fontsReady, setFontsReady] = useState(false);
  const [supportersSettled, setSupportersSettled] = useState(false);
  const [configSettled, setConfigSettled] = useState(false);
  const [artReady, setArtReady] = useState(false);
  const [booted, setBooted] = useState(false);
  // Kept mounted through the fade so the counter emerges from the curtain
  // rather than replacing it.
  const [curtainMounted, setCurtainMounted] = useState(true);

  const [screen, setScreen] = useState<Screen>("counter");
  const [cur, setCur] = useState<DisplayCurrency>("THB");
  // Seeded from the static fallback; overridden by /api/menu once it resolves
  // (uuid ids replace the fallback's literal ones — see the menu-load effect,
  // which re-picks itemId onto the live list so the pre-selected treat sticks).
  const [menu, setMenu] = useState<Treat[]>(MENU);
  const [cafeName, setCafeName] = useState(FALLBACK_CAFE_NAME);
  const [flowerLine, setFlowerLine] = useState(FLOWER_LINE);
  const [idleLines, setIdleLines] = useState<IdleLine[]>(IDLE_LINES);
  const [ttsThreshold, setTtsThreshold] = useState(TTS_THRESHOLD_THB);
  const [realVoiceOn, setRealVoiceOn] = useState(true);
  const [pickTemplate, setPickTemplate] = useState<VoiceTemplate>(PICK_TEMPLATE_DEFAULT);
  const [thanksTemplate, setThanksTemplate] = useState<VoiceTemplate>(THANKS_TEMPLATE_DEFAULT);
  const [currentWeather, setCurrentWeather] = useState<WeatherTag | null>(null);
  // Resolved async from the typed name (debounced) — first/returning/top/away,
  // or null before it resolves / for an empty name. Purely a dialogue flavor;
  // never blocks anything if the lookup fails or is slow.
  const [guestTag, setGuestTag] = useState<GuestTag | null>(null);
  const [emotionImages, setEmotionImages] = useState<DeviceEmotionImages>(EMPTY_EMOTIONS);
  const [sceneImages, setSceneImages] = useState<DeviceSceneImages>(EMPTY_SCENES);
  // Guest's local hour, re-read once on mount — the backdrop doesn't need to
  // tick live, just to match whenever the page loaded.
  const [guestHour] = useState(() => new Date().getHours());
  // Currently-shown idle line's id, so the next pick can avoid repeating it.
  const [currentLineId, setCurrentLineId] = useState<string | null>(IDLE_LINES[0]?.id ?? null);
  // Nothing pre-selected — the counter starts idle (neutral face, empty
  // amount) until a guest actually picks a treat or types their own amount.
  // A prior version pre-selected the first treat, which meant "neutral"
  // could never actually show on load — see cafe-panel-full-build memory.
  const [itemId, setItemId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>(""); // "" = everything
  const [amount, setAmount] = useState<string>(""); // display units (fills from the picked treat)
  const [amtFocus, setAmtFocus] = useState(false);
  // Boolean, not the message string: the warning is re-rendered from the current
  // language each paint, so switching TH/EN updates a shown warning immediately.
  const [amtErr, setAmtErr] = useState(false);

  const [name, setName] = useState("");
  const [nameFocus, setNameFocus] = useState(false);
  const [anon, setAnon] = useState(false);
  const [message, setMessage] = useState("");
  const [msgFocus, setMsgFocus] = useState(false);
  const [priv, setPriv] = useState(false);
  // Live from Privacy & moderation; defaults preserve today's behavior (not
  // anonymous by default, sealed-message checkbox always offered) until the
  // config fetch resolves.
  const [sealedAllowed, setSealedAllowed] = useState(true);
  const [anonTip, setAnonTip] = useState(false);
  const [privTip, setPrivTip] = useState(false);
  const [mailTip, setMailTip] = useState(false);

  const [method, setMethod] = useState<Method>("promptpay");
  const [email, setEmail] = useState("");
  const [mailErr, setMailErr] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [topName, setTopName] = useState<string>("");
  const [recent, setRecent] = useState<RecentSupporter[]>([]);
  // Seeded from the static default; overridden by /api/goal when an active goal exists.
  // showOnCounter starts FALSE on purpose: it is a creator setting, and the only
  // honest default before the fetch answers is "don't show it". Defaulting to
  // true flashed the bar on every load and — because the catch below leaves the
  // seed in place — left it permanently visible to anyone whose /api/goal call
  // failed, even with the setting switched off.
  const [goal, setGoal] = useState<{ label: string; kind: "local" | "wishlist"; targetThb: number; raisedThb: number; deadline: string | null; showOnCounter: boolean; showOnShare: boolean }>({
    label: "",
    kind: "local",
    targetThb: GOAL.targetThb,
    raisedThb: GOAL.raisedThb,
    deadline: null,
    showOnCounter: false,
    showOnShare: true,
  });
  const [shareAmount, setShareAmount] = useState(true);
  const [shareNote, setShareNote] = useState(true);
  const [shareGoal, setShareGoal] = useState(true);
  const [copied, setCopied] = useState(false);

  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [ppSubmitting, setPpSubmitting] = useState(false);
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number | null>(null);
  const [qrSaving, setQrSaving] = useState(false);
  const [qrSaved, setQrSaved] = useState(false);

  // dialogue typewriter
  const [target, setTarget] = useState(idleLines[0][lang]);
  const [typed, setTyped] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptNonceRef = useRef<string>("");

  const selected: Treat | null = useMemo(() => menu.find((t) => t.id === itemId) ?? null, [itemId, menu]);
  const symbol = CUR_BY_CODE[cur].symbol;
  // Minimum tip (THB) = the cheapest treat's price, so every menu item is
  // payable; ฿20 (the currency floor) if a creator ever empties the menu.
  const MIN_TIP_THB = useMemo(
    () => (menu.length > 0 ? Math.min(...menu.map((t) => t.price)) : 20),
    [menu]
  );

  // Guest-facing tag filter. "" = show everything. Tags are the union across the
  // live menu, in first-seen order; the chip row hides itself when no treat is
  // tagged. The filter only narrows what's shown — the picked treat, min tip and
  // totals all still read from the full menu.
  const allTags = useMemo(() => {
    const seen: string[] = [];
    for (const t of menu) for (const tag of t.tags) if (!seen.includes(tag)) seen.push(tag);
    return seen;
  }, [menu]);
  const shownMenu = useMemo(
    () => (tagFilter ? menu.filter((t) => t.tags.includes(tagFilter)) : menu),
    [menu, tagFilter]
  );

  const baseThb = amount ? displayToThb(Number(amount), cur) : 0;
  const totalThb = Math.max(0, Math.round(baseThb));
  const totalDisplayLabel = fmtDisplay(totalThb, cur);
  const emailOk = EMAIL_RE.test(email.trim());

  // The charge is in the SELECTED display currency (USD/JPY charged as-is, not
  // converted to THB). chargeAmount is exactly the AMOUNT DUE the payer sees.
  // PromptPay is THB-only (Stripe constraint), so non-THB is card-only.
  const chargeCurrency = cur.toLowerCase() as Currency;
  const chargeAmount = toDisplay(totalThb, cur);
  const curMin = MONEY_CFG[chargeCurrency].min;
  const promptPayAvailable = chargeCurrency === PROMPTPAY_CURRENCY;
  const showPromptPay = promptPayAvailable && method === "promptpay";
  // Minimum shown in the current display currency (e.g. ฿20 / $0.6 / ¥90).
  const amtErrMsg = c.minWarn(fmtDisplay(MIN_TIP_THB, cur));

  const goalPctRaw = goal.targetThb > 0 ? (goal.raisedThb / goal.targetThb) * 100 : 0;
  const goalPct = Math.min(100, goalPctRaw);
  // A wishlist goal can read past 100% (tips are uncapped, PLAN §6); its number
  // shows the true value while the fill (goalPct) still caps at the track.
  const goalPctShown = goal.kind === "wishlist" ? goalPctRaw : goalPct;
  const previewPct = totalThb > 0 ? Math.min(100 - goalPct, Math.max(1.5, (totalThb / goal.targetThb) * 100)) : 0;
  // Creator-level master switch (Settings → Goal → "On share cards") wins
  // over the guest's own toggle — off means the goal never appears in a
  // share image, regardless of what the guest last clicked.
  const canShareGoal = shareGoal && goal.showOnShare;
  const ttsPct = Math.min(100, (totalThb / ttsThreshold) * 100);
  // realVoiceOn is a creator-level switch for the whole "real voice" promise
  // (Settings → Alerts). Off means no unlock, ever, regardless of amount.
  const ttsUnlocked = realVoiceOn && totalThb >= ttsThreshold;

  const orderSummary = selected ? selected[lang] : fmtDisplay(baseThb, cur);
  // Receipt thank-you — nothing rendered this before Voice's templates existed.
  const thanksMessage = renderTemplate(thanksTemplate[lang], {
    name: anon || !name.trim() ? c.anonName : name.trim(),
    item: orderSummary,
    amount: totalDisplayLabel,
  });

  // Portrait/backdrop. Priority: TTS unlocked (sparkle) > a treat picked
  // (smile) > raining today (sad) > idle (neutral). Mobile and desktop each
  // have their own uploaded crop — a large rectangle in the desktop left
  // rail rarely also suits the small square band next to Naire's dialogue
  // on mobile — so both are computed here and picked at each render site.
  const scene: Scene = sceneForHour(guestHour);
  const emotion: Emotion = ttsUnlocked ? "sparkle" : selected ? "smile" : currentWeather === "rain" ? "sad" : "neutral";
  const dither = "repeating-linear-gradient(135deg,#EEDCBE 0 8px,#E7D2B0 8px 16px)";
  const portraitBgDesktop = sceneImages.desktop[scene] ? `center / cover no-repeat url("${sceneImages.desktop[scene]}")` : dither;
  const portraitImgDesktop = emotionImages.desktop[emotion];
  const portraitBgMobile = sceneImages.mobile[scene] ? `center / cover no-repeat url("${sceneImages.mobile[scene]}")` : dither;
  const portraitImgMobile = emotionImages.mobile[emotion];

  // Voice's condition engine: time is the guest's own local hour; weather is
  // the creator's manually-set value; guest is resolved async below from the
  // typed name. "Most specific match wins" — see pickIdleLine in lib/cafe.ts.
  const activeTags: ConditionTag[] = [timeTagForHour(guestHour), ...(currentWeather ? [currentWeather] : []), ...(guestTag ? [guestTag] : [])];

  // ── typewriter ────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTyped("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [target]);

  function say(line: string) {
    setTarget(line);
  }

  useEffect(() => {
    document.documentElement.lang = lang;
    // retype the SAME current line (by id) in the new language — a language
    // switch shouldn't also re-roll which line is showing.
    if (screen === "counter" && !selected) {
      const current = idleLines.find((l) => l.id === currentLineId) ?? idleLines[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (current) say(current[lang]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Debounced guest-bucket lookup for Voice's condition engine — resolves
  // after the payer stops typing their name. Best-effort: a slow/failed
  // lookup just leaves guestTag null, which pickIdleLine treats as "no guest
  // condition" rather than an error.
  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGuestTag(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/supporter-status?name=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setGuestTag(data?.tag ?? null))
        .catch(() => {
          /* leave guestTag as-is */
        });
    }, 600);
    return () => clearTimeout(t);
  }, [name]);

  // Once the guest bucket resolves, re-greet with a more specific line if the
  // payer hasn't moved past the counter yet.
  useEffect(() => {
    if (screen !== "counter" || selected) return;
    const next = pickIdleLine(idleLines, activeTags, currentLineId ?? undefined);
    if (next.id !== currentLineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentLineId(next.id);
      say(next[lang]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestTag]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Prefill username + email for a returning guest from the last tip on this
  // device (saveContact writes these on pay). Client-only, post-mount, so it
  // can't cause a hydration mismatch. `name` is a username handle, not a legal
  // name, so restoring it on a shared device is acceptable.
  useEffect(() => {
    try {
      const savedName = window.localStorage.getItem("tipperName");
      const savedEmail = window.localStorage.getItem("tipperEmail");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (savedName) setName(savedName);
      if (savedEmail) setEmail(savedEmail);
    } catch {
      /* localStorage unavailable (private mode / blocked) — non-fatal */
    }
  }, []);

  // Viewport → mobile/desktop shell. matchMedia (not resize) so it only fires on
  // the actual breakpoint crossing.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // QR countdown — starts ticking once the PromptPay QR is generated.
  useEffect(() => {
    if (qrExpiresAt === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQrSecondsLeft(null);
      return;
    }
    const tick = () => setQrSecondsLeft(Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt]);

  // Top supporter uses the MONTHLY window; recent list is the latest tips; goal
  // is the live café goal + raised total. All public, refreshed after each tip.
  const loadSupporters = useCallback(async () => {
    try {
      const [sup, goalRes] = await Promise.all([
        fetch("/api/supporters?timeframe=month").then((r) => r.json()),
        fetch("/api/goal").then((r) => r.json()),
      ]);
      if (Array.isArray(sup.top)) setTopName(sup.top[0]?.displayName ?? "");
      if (Array.isArray(sup.recent)) setRecent(sup.recent as RecentSupporter[]);
      if (goalRes?.goal) {
        setGoal({
          label: goalRes.goal.label ?? "",
          kind: goalRes.goal.kind === "wishlist" ? "wishlist" : "local",
          targetThb: goalRes.goal.targetThb,
          raisedThb: goalRes.goal.raisedThb,
          deadline: goalRes.goal.deadline ?? null,
          showOnCounter: goalRes.goal.showOnCounter ?? true,
          showOnShare: goalRes.goal.showOnShare ?? true,
        });
      }
      // No else: a resolved fetch that found no active goal (never configured,
      // or auto-hidden by the "take the bar down" ending) leaves the seed's
      // showOnCounter: false in place, which is already the right answer.
    } catch {
      /* leave the strip in place on failure; the goal bar stays hidden */
    } finally {
      // Settled, not succeeded: the curtain waits for an answer, not a good one.
      setSupportersSettled(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSupporters();
  }, [loadSupporters]);

  // Live menu + café config from Settings, overriding the static fallbacks
  // above. On failure the fallbacks stay in place — the tip page must keep
  // working even if this fetch never resolves.
  const loadMenuConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/menu");
      if (res.ok) {
        const data = await res.json();
        const liveMenu = (data.items ?? []) as MenuItemDto[];
        if (liveMenu.length > 0) {
          const mapped: Treat[] = liveMenu.map((m) => ({ id: m.id, th: m.th, en: m.en, price: m.price, hidden: false, tails: m.tails, tags: m.tags ?? [], thumbUrl: m.thumbUrl ?? null }));
          setMenu(mapped);
          // null (nothing picked) is a valid, intentional state — leave it
          // alone. Only remap a stale non-null id (the old fallback list's
          // literal ids, e.g. before the live menu loaded) onto the live list.
          setItemId((cur) => (cur === null || mapped.some((t) => t.id === cur) ? cur : mapped[0].id));
        }
      }
    } catch {
      /* keep the static fallback menu */
    }
    try {
      const res = await fetch("/api/cafe-config");
      if (res.ok) {
        const data = await res.json();
        const cfg = data.config as CafeConfigDto | null;
        if (cfg) {
          setCafeName(cfg.name);
          setFlowerLine(cfg.flowerLine);
          if (cfg.idleLines.length > 0) {
            setIdleLines(cfg.idleLines);
            // The first paint began with the static fallback. Re-select from
            // the saved Voice lines as soon as config arrives, otherwise the
            // fallback remains in the dialogue box until a guest clicks next
            // or their supporter bucket resolves.
            const liveTags: ConditionTag[] = [
              timeTagForHour(guestHour),
              ...(cfg.currentWeather ? [cfg.currentWeather] : []),
              ...(guestTag ? [guestTag] : []),
            ];
            const initialLine = pickIdleLine(cfg.idleLines, liveTags);
            setCurrentLineId(initialLine.id);
            say(initialLine[lang]);
          }
          setTtsThreshold(cfg.ttsThresholdThb);
          setRealVoiceOn(cfg.realVoiceOn);
          setPickTemplate(cfg.pickTemplate);
          setThanksTemplate(cfg.thanksTemplate);
          setCurrentWeather(cfg.currentWeather);
          setEmotionImages(cfg.emotionImages);
          setSceneImages(cfg.sceneImages);
          setAnon(cfg.anonDefault);
          setSealedAllowed(cfg.sealedAllowed);
        }
      }
    } catch {
      /* keep the static fallback config */
    } finally {
      setConfigSettled(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMenuConfig();
  }, [loadMenuConfig]);

  // Emotion portraits swap mid-interaction (picking a treat → smile, crossing
  // the TTS threshold → sparkle), and each unseen face is otherwise a cold
  // fetch from the assets bucket at the exact moment it should already be on
  // screen — the swap visibly lags. Warm the whole set for the active device
  // once the config lands, at low priority so it never competes with the
  // portrait actually being painted (the visible URL dedupes against its own
  // in-flight request rather than fetching twice). The refs are held so the
  // decoded bitmaps aren't collected before they're needed.
  //
  // Backdrops are deliberately not preloaded: `scene` is pinned to the guest's
  // local hour at mount, so the other two never render on this page load.
  const preloadedPortraits = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    if (isMobile === null) return;
    const set = isMobile ? emotionImages.mobile : emotionImages.desktop;
    preloadedPortraits.current = (Object.values(set).filter(Boolean) as string[]).map((url) => {
      const img = new Image();
      img.decoding = "async";
      img.setAttribute("fetchpriority", "low");
      img.src = url;
      return img;
    });
  }, [emotionImages, isMobile]);

  // ── Boot curtain: fonts ───────────────────────────────────────────────────
  // The pixel faces are self-hosted by next/font with display:swap, so without
  // this the counter paints in a fallback and then re-flows into DotGothic /
  // Silkscreen — the single most visible part of the old "snap".
  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setFontsReady(true);
    };
    const t = setTimeout(done, BOOT_FONT_MS);
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(done).catch(done);
    } else {
      done();
    }
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // ── Boot curtain: artwork ─────────────────────────────────────────────────
  // Only the two bitmaps this load will actually paint — the backdrop for the
  // guest's local hour and the portrait for the opening emotion. The rest of
  // the set is warmed at low priority by the preload effect above, behind the
  // curtain rather than in front of it. A missing or slow asset resolves the
  // same way an arriving one does; the dither fallback is a fine first paint.
  useEffect(() => {
    if (isMobile === null || !configSettled) return;
    const urls = [
      isMobile ? portraitImgMobile : portraitImgDesktop,
      isMobile ? sceneImages.mobile[scene] : sceneImages.desktop[scene],
    ].filter(Boolean) as string[];
    if (urls.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArtReady(true);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setArtReady(true);
    };
    const t = setTimeout(finish, BOOT_ART_MS);
    Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
          }),
      ),
    ).then(finish);
    return () => clearTimeout(t);
  }, [configSettled, isMobile, portraitImgMobile, portraitImgDesktop, sceneImages, scene]);

  // ── Boot curtain: lift ────────────────────────────────────────────────────
  const bootSteps: boolean[] = [isMobile !== null, fontsReady, configSettled && supportersSettled, artReady];
  const bootReady = bootSteps.every(Boolean);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (bootReady) setBooted(true);
  }, [bootReady]);
  // The floor under everything: a guest never waits on the café's own plumbing
  // for longer than this, whatever is still outstanding.
  useEffect(() => {
    const t = setTimeout(() => setBooted(true), BOOT_MAX_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!booted) return;
    const t = setTimeout(() => setCurtainMounted(false), BOOT_FADE_MS);
    return () => clearTimeout(t);
  }, [booted]);
  const curtain = curtainMounted ? <CafeCurtain lang={lang} steps={bootSteps} leaving={booted} /> : null;

  // 3-D Secure card return: the redirect reloads the page (wiping React state) and
  // comes back to /?pi=…. Rebuild from the `tip:${pi}` sessionStorage stash that
  // CardForm wrote, confirm status once, and land on the receipt (or back on pay).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const pi = params.get("pi") || params.get("payment_intent");
    if (!pi || !pi.startsWith("pi_")) return;

    try {
      const raw = sessionStorage.getItem(`tip:${pi}`);
      if (raw) {
        const s = JSON.parse(raw) as { name?: string; amount?: number; displayCur?: DisplayCurrency; message?: string; keepSecret?: boolean };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(String(s.name ?? ""));
        setCur(s.displayCur === "USD" || s.displayCur === "JPY" ? s.displayCur : "THB");
        setItemId(null);
        setAmount(s.amount != null ? String(s.amount) : "");
        setMessage(String(s.message ?? ""));
        setPriv(Boolean(s.keepSecret));
      }
    } catch {
      /* stash unavailable — receipt still renders with the intent id */
    }

    (async () => {
      try {
        const res = await fetch(`/api/check-status?id=${pi}`);
        const data = await res.json();
        if (data.status === "SUCCESS") {
          setPaymentIntentId(pi);
          setScreen("receipt");
          loadSupporters();
        } else {
          setScreen("pay");
        }
      } catch {
        setScreen("pay");
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getIdempotencyKey() {
    if (!attemptNonceRef.current) attemptNonceRef.current = newNonce();
    return idempotencyKey(attemptNonceRef.current, [name, chargeAmount, chargeCurrency, method, message, priv, email]);
  }

  function pickTreat(t: Treat) {
    setItemId(t.id);
    setAmount(String(toDisplay(t.price, cur))); // selecting a treat fills the amount box
    setAmtErr(false);
    // A treat's own tails (Menu panel) are the {{line}} token — random per
    // pick, same "picked at random" spirit as the design's tail editor.
    // pickTreat only ever runs from a treat button's onClick (event time),
    // never during render.
    // eslint-disable-next-line react-hooks/purity
    const tail = t.tails.length > 0 ? t.tails[Math.floor(Math.random() * t.tails.length)] : null;
    say(renderTemplate(pickTemplate[lang], { item: t[lang], amount: fmtDisplay(t.price, cur), line: tail ? tail[lang] : "" }));
  }

  function handleAmount(raw: string) {
    setAmount(sanitizeAmount(raw));
    setItemId(null); // typing a custom amount clears the selected treat
    setAmtErr(false);
  }

  // Switching display currency reconverts the amount, preserving its THB value.
  // PromptPay is THB-only, so leaving THB forces the card method (and drops any
  // QR minted on a prior THB attempt).
  function changeCurrency(next: DisplayCurrency) {
    const thb = displayToThb(Number(amount) || 0, cur);
    setCur(next);
    setAmount(amount ? String(toDisplay(thb, next)) : "");
    setAmtErr(false);
    if (next !== "THB" && method === "promptpay") {
      setMethod("card");
      if (pollRef.current) clearInterval(pollRef.current);
      setQrImageUrl(null);
      setQrExpiresAt(null);
      setPaymentIntentId(null);
      attemptNonceRef.current = "";
    }
  }

  function nextLine() {
    const next = pickIdleLine(idleLines, activeTags, currentLineId ?? undefined);
    setCurrentLineId(next.id);
    say(next[lang]);
  }

  function goCheckout() {
    // Minimum is the cheapest treat's price (฿20 ≈ $0.6 / ¥90), so any menu item
    // is payable in any display currency.
    if (totalThb < MIN_TIP_THB) {
      setAmtErr(true);
      return;
    }
    setAmtErr(false);
    setScreen("pay");
    say(c.payLine);
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/check-status?id=${id}`);
        const data = await res.json();
        if (data.status === "SUCCESS") {
          if (pollRef.current) clearInterval(pollRef.current);
          attemptNonceRef.current = "";
          setScreen("receipt");
          loadSupporters();
        }
      } catch (err) {
        console.error("poll error", err);
      }
    }, POLL_MS);
  }

  async function submitPromptPay(opts?: { force?: boolean }) {
    setMailErr(false);
    if (!emailOk) {
      setMailErr(true);
      return;
    }
    if (qrImageUrl && !opts?.force) return; // already generated
    setPpSubmitting(true);
    try {
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, amount: totalThb, currency: "thb", message,
          showOnScreen: !priv, email, method: "promptpay", idempotencyKey: getIdempotencyKey(), itemId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPpSubmitting(false);
        return;
      }
      setQrImageUrl(data.qrImageUrl);
      setQrExpiresAt(Date.now() + QR_TTL_MS);
      setPaymentIntentId(data.paymentIntentId);
      startPolling(data.paymentIntentId);
    } catch (err) {
      console.error(err);
    } finally {
      setPpSubmitting(false);
    }
  }

  // A fresh nonce forces a new idempotency key, so this mints a brand new
  // PaymentIntent (and QR) rather than replaying the expired one.
  function retryQr() {
    setQrImageUrl(null);
    setQrExpiresAt(null);
    setPaymentIntentId(null);
    attemptNonceRef.current = "";
    void submitPromptPay({ force: true });
  }

  // Auto-generate the QR the moment a valid email is present on the PromptPay path.
  useEffect(() => {
    if (screen === "pay" && promptPayAvailable && method === "promptpay" && emailOk && !qrImageUrl && !ppSubmitting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void submitPromptPay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, method, emailOk]);

  function saveContact() {
    try {
      window.localStorage.setItem("tipperEmail", email.trim());
      if (name.trim()) window.localStorage.setItem("tipperName", name.trim());
    } catch {
      /* non-fatal */
    }
  }

  function backToOrder() {
    if (pollRef.current) clearInterval(pollRef.current);
    setScreen("counter");
    setQrImageUrl(null);
    setQrExpiresAt(null);
    setPaymentIntentId(null);
    attemptNonceRef.current = "";
  }

  function resetAll() {
    backToOrder();
    const first = menu[0] ?? null;
    setItemId(first?.id ?? null);
    setAmount(first ? String(toDisplay(first.price, cur)) : "20");
    setMessage("");
    setPriv(false);
    const line = pickIdleLine(idleLines, activeTags);
    setCurrentLineId(line.id);
    say(line[lang]);
  }

  // Mobile top-bar back arrow: pay → order (drops any QR), receipt → fresh café.
  function mobileBack() {
    if (screen === "pay") backToOrder();
    else if (screen === "receipt") resetAll();
  }

  const elementsOptions: StripeElementsOptionsMode = useMemo(
    () => ({
      mode: "payment",
      amount: toMinorUnits(chargeAmount || curMin, chargeCurrency),
      currency: chargeCurrency,
      paymentMethodTypes: ["card"],
      appearance: STRIPE_APPEARANCE,
      locale: "en",
    }),
    [chargeAmount, curMin, chargeCurrency]
  );

  const receiptNo = paymentIntentId ? "WRC-" + paymentIntentId.slice(-6).toUpperCase() : "WRC-000000";
  const stamp = fmtStamp(new Date());
  const monthName = new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US", { month: "long" });

  function copyShareLink() {
    try {
      navigator.clipboard?.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }
  // Render the 1080×1920 Instagram-story card on an offscreen canvas and download
  // it. Reimplements the prototype's drawStory; honors the three share toggles.
  // No network — uses the already-loaded self-hosted pixel fonts, resolved from
  // the DOM's CSS variables (next/font registers them under generated names).
  async function saveStory() {
    try {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    } catch {
      /* fonts API unavailable — draw with whatever is loaded */
    }
    const disp = resolveFont("--font-display");
    const mono = resolveFont("--font-label");
    const body = resolveFont("--font-body");

    const W = 1080, H = 1920, pad = 72;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = (text: string, font: string, color: string, x: number, y: number, align: CanvasTextAlign = "left") => {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    };
    const wrap = (text: string, font: string, max: number): string[] => {
      ctx.font = font;
      const out: string[] = [];
      let line = "";
      for (const w of String(text).split(/\s+/)) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > max && line) {
          out.push(line);
          line = w;
        } else line = test;
      }
      if (line) out.push(line);
      return out;
    };

    // Backdrop (no photo art → the plum ground + gradient).
    ctx.fillStyle = "#7A3F49";
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(95,58,64,.6)");
    grad.addColorStop(0.32, "rgba(95,58,64,.16)");
    grad.addColorStop(1, "rgba(58,30,36,.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Header.
    ctx.fillStyle = "#FDD3E0";
    ctx.fillRect(pad, 92, 58, 58);
    t("✿", "30px " + body, "#7A3F49", pad + 29, 132, "center");
    t(cafeName, "40px " + disp, "#FFF1E2", pad + 78, 134);
    t(stamp, "20px " + mono, "#F2D9C6", W - pad, 130, "right");

    const paid = fmtDisplay(totalThb, cur);
    const note = message.trim();
    const barW = W - pad * 2;
    let y = H - pad;

    t(c.shareCta, "20px " + mono, "#F2D9C6", W - pad, y, "right");
    t(SHARE_HANDLE, "24px " + mono, "#FDD3E0", pad, y);
    y -= 54;

    if (canShareGoal) {
      const pctNum = Math.min(100, ((goal.raisedThb + totalThb) / goal.targetThb) * 100);
      ctx.fillStyle = "rgba(253,245,228,.26)";
      ctx.fillRect(pad, y - 26, barW, 26);
      ctx.fillStyle = "#EE93AB";
      ctx.fillRect(pad + 4, y - 22, Math.max(0, ((barW - 8) * pctNum) / 100), 18);
      y -= 40;
      t(`${fmtDisplay(goal.raisedThb + totalThb, cur)} / ${fmtDisplay(goal.targetThb, cur)}`, "22px " + mono, "#FFF1E2", W - pad, y, "right");
      t(c.goalLabel, "20px " + mono, "#F2D9C6", pad, y);
      y -= 40;
    }

    if (shareNote && note) {
      const lines = wrap(note, "28px " + body, barW - 56);
      const boxH = lines.length * 44 + 40;
      y -= boxH;
      ctx.fillStyle = "rgba(253,245,228,.94)";
      ctx.fillRect(pad, y, barW, boxH);
      ctx.fillStyle = "#F4A9BD";
      ctx.fillRect(pad + 20, y + 26, 16, 16);
      let ly = y + 48;
      for (const l of lines) {
        t(l, "28px " + body, "#6B2F3A", pad + 52, ly);
        ly += 44;
      }
      y -= 34;
    }

    if (shareAmount) {
      ctx.font = "34px " + mono;
      const w = ctx.measureText(paid).width + 40;
      y -= 62;
      ctx.fillStyle = "#9E4B54";
      ctx.fillRect(pad, y + 8, w, 54);
      ctx.fillStyle = "#FDD3E0";
      ctx.fillRect(pad, y, w, 54);
      t(paid, "34px " + mono, "#7A3F49", pad + 20, y + 38);
      y -= 18;
    }

    const nameLines = wrap(orderSummary, "56px " + disp, barW);
    y -= nameLines.length * 64;
    let ny = y + 52;
    for (const l of nameLines) {
      t(l, "56px " + disp, "#FFF6E2", pad, ny);
      ny += 64;
    }
    y -= 22;
    t(c.shareKicker, "22px " + mono, "#F4A9BD", pad, y);
    y -= 40;

    // Treat block (no art → framed dither swatch).
    const tS = 280;
    y -= tS;
    ctx.fillStyle = "#9E4B54";
    ctx.fillRect(pad - 12, y - 12, tS + 24, tS + 24);
    ctx.fillStyle = "#FFF1E2";
    ctx.fillRect(pad - 6, y - 6, tS + 12, tS + 12);
    ctx.fillStyle = "#EEDCBE";
    ctx.fillRect(pad, y, tS, tS);

    const link = document.createElement("a");
    link.download = "whispering-rain-story-" + receiptNo + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
  // "Save QR code" doesn't just download the bare Stripe PNG — it renders the
  // same ticket the payer sees (payee, QR, total, expiry) onto an offscreen
  // canvas, so the photo saved to their phone is self-contained: still legible
  // as a receipt on its own, without the surrounding app chrome. qr.stripe.com
  // sends no CORS headers, so the QR bitmap is loaded via our own
  // /api/qr-download proxy first — an image drawn to canvas from a bare
  // cross-origin fetch would taint the canvas and block the final export.
  async function saveQr() {
    if (!qrImageUrl || qrSaving) return;
    setQrSaving(true);
    try {
      const res = await fetch("/api/qr-download?url=" + encodeURIComponent(qrImageUrl));
      if (!res.ok) throw new Error("QR fetch failed");
      const bitmap = await createImageBitmap(await res.blob());

      try {
        await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
      } catch {
        /* fonts API unavailable — draw with whatever is loaded */
      }
      const disp = resolveFont("--font-dotgothic");
      const label = resolveFont("--font-silkscreen");
      const body = resolveFont("--font-body");

      const W = 720;
      const pad = 44;
      const barW = W - pad * 2;
      const HEADER_H = 92;
      const BODY_TOP_PAD = 40;
      const QR_SIZE = 384;
      const QR_PAD = 20;
      const QR_PANEL = QR_SIZE + QR_PAD * 2;
      const GAP_AFTER_QR = 36;
      const DIVIDER_H = 3;
      const GAP_AFTER_DIVIDER = 32;
      const ROW_H = 56;
      const ROW_GAP = 16;
      const CAPTION_TOP = 32;
      const CAPTION_LINE_H = 32;
      const BOTTOM_PAD = 40;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const t = (text: string, font: string, color: string, x: number, y: number, align: CanvasTextAlign = "left") => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
      };
      const wrap = (text: string, font: string, max: number): string[] => {
        ctx.font = font;
        const out: string[] = [];
        let line = "";
        for (const w of text.split(/\s+/)) {
          const test = line ? line + " " + w : w;
          if (ctx.measureText(test).width > max && line) {
            out.push(line);
            line = w;
          } else line = test;
        }
        if (line) out.push(line);
        return out;
      };

      const payTo = qc.qrPayTo(STREAMER_NAME);
      const expiryValue = qrExpiresAt ? fmtExpiry(new Date(qrExpiresAt)) : "";
      const expiryColor = qrSecondsLeft !== null && qrSecondsLeft <= 60 ? "#C4646F" : "#7A3F49";
      const captionLines = wrap(qc.qrBody, "22px " + body, barW);

      canvas.width = W;
      canvas.height =
        HEADER_H + BODY_TOP_PAD + QR_PANEL + GAP_AFTER_QR + DIVIDER_H + GAP_AFTER_DIVIDER +
        ROW_H * 2 + ROW_GAP + CAPTION_TOP + captionLines.length * CAPTION_LINE_H + BOTTOM_PAD;

      // Card paper + header strip.
      ctx.fillStyle = "#FFFBF2";
      ctx.fillRect(0, 0, W, canvas.height);
      ctx.fillStyle = "#7A3F49";
      ctx.fillRect(0, 0, W, HEADER_H);

      t(payTo, "26px " + disp, "#FFF6E2", W / 2, HEADER_H / 2 + 9, "center");

      // QR panel — crop-zoom matches the on-screen scale(1.41) treatment that
      // trims the wide quiet-margin Stripe bakes into the source PNG.
      let y = HEADER_H + BODY_TOP_PAD;
      const qrX = (W - QR_PANEL) / 2;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qrX, y, QR_PANEL, QR_PANEL);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#9E4B54";
      ctx.strokeRect(qrX + 3, y + 3, QR_PANEL - 6, QR_PANEL - 6);
      const cropFrac = 1 / 1.2;
      const marginFrac = (1 - cropFrac) / 2;
      ctx.drawImage(
        bitmap,
        0, 0, bitmap.width, bitmap.height,
        qrX + QR_PAD, y + QR_PAD, QR_SIZE, QR_SIZE
      );
      y += QR_PANEL + GAP_AFTER_QR;

      // Ticket tear line.
      ctx.strokeStyle = "#DBB79A";
      ctx.lineWidth = DIVIDER_H;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
      ctx.setLineDash([]);
      y += DIVIDER_H + GAP_AFTER_DIVIDER;

      // Receipt line items.
      t(qc.qrTotalLabel, "20px " + label, "#9A6656", pad, y + 10, "left");
      t(totalDisplayLabel, "40px " + disp, "#9E4B54", W - pad, y + 16, "right");
      y += ROW_H + ROW_GAP;
      t(qc.qrExpiryLabel, "20px " + label, "#9A6656", pad, y + 8, "left");
      t(expiryValue, "22px " + label, expiryColor, W - pad, y + 10, "right");
      y += ROW_H;

      // Scan instructions caption.
      y += CAPTION_TOP;
      for (const line of captionLines) {
        t(line, "22px " + body, "#8E6B5B", W / 2, y, "center");
        y += CAPTION_LINE_H;
      }

      const link = document.createElement("a");
      link.download = "promptpay-qr-ticket.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      setQrSaved(true);
      setTimeout(() => setQrSaved(false), 2000);
    } catch {
      window.open(qrImageUrl, "_blank");
    } finally {
      setQrSaving(false);
    }
  }
  const menuCols = `repeat(${MENU_GRID_COLS}, minmax(0,1fr))`;

  // Desktop goal-card placement. The menu grid is 3-up, so 1-6 treats fill two
  // rows and the goal sits under the menu; the 7th treat opens a third row and
  // the menu column overshoots the left rail (portrait + message box). Past
  // that point the goal moves under the order slip, which is the shorter of the
  // two right-hand columns, so the extra card costs no total height.
  const goalBelowSlip = shownMenu.length > MENU_GRID_COLS * GOAL_UNDER_MENU_MAX_ROWS;
  // `compact` is the under-the-slip variant: the same card on a tighter pitch,
  // because that column has only the left rail's leftover height to spend.
  const goalCardDesktop = (marginTop: number, compact = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6, padding: compact ? "9px 12px" : "12px 14px", background: "#FBE3C4", border: "3px solid #9E4B54", boxShadow: "0 4px 0 #DBB79A", marginTop }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9E4B54" }}>{c.goalLabel}</span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          {totalThb > 0 && <span style={{ fontFamily: mono, fontSize: 9, color: "#C4818F" }}>+{fmtDisplay(totalThb, cur)}</span>}
          <span style={{ fontFamily: dot, fontSize: 16, lineHeight: 1, color: "#9E4B54" }}>{Math.round(goalPctShown)}%</span>
        </span>
      </div>
      <div style={{ fontSize: 14.5, color: "#7A3F49" }}>{goal.label || c.goalItem}</div>
      <div style={{ height: 10, background: "#FFF", border: "2px solid #9E4B54", padding: 1, display: "flex" }}>
        <div style={{ height: "100%", flex: "none", background: "repeating-linear-gradient(90deg,#F4A9BD 0 6px,#EE93AB 6px 12px)", transition: "width .35s steps(8)", width: `${goalPct}%` }} />
        <div className="anim-goalprev" style={{ height: "100%", flex: "none", width: `${previewPct}%`, background: "repeating-linear-gradient(90deg,#9E4B54 0 4px,rgba(158,75,84,.2) 4px 8px)", transition: "width .35s steps(8)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>
        <span>{baht(goal.raisedThb)}</span>
        <span style={{ color: "#B07B6A" }}>{baht(goal.targetThb)}</span>
      </div>
      {goal.deadline && <div style={{ fontSize: 10.5, color: "#8E6B5B" }}>{c.goalUntil(fmtGoalDeadline(goal.deadline))}</div>}
    </div>
  );
  const stepLabel = screen === "counter" ? "1/3" : screen === "pay" ? "2/3" : "3/3";

  // Hold the plum background until the viewport class is known, so the server
  // render and first client paint agree (no desktop→mobile flash).
  if (isMobile === null) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#5F3A40" }}>
        {curtain}
      </div>
    );
  }

  // ── Mobile shell (Whispering Rain Cafe Mobile.dc.html) ──────────────────────
  if (isMobile) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#5F3A40", display: "flex", justifyContent: "center" }}>
        {curtain}
        <div style={{ width: "100%", maxWidth: 460, height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "#FDF5E4", boxShadow: "0 0 0 3px #C4818F" }}>
          {/* sticky top bar */}
          <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px 12px", background: "#FDF5E4", borderBottom: "3px solid #9E4B54" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {screen !== "counter" && (
                <button onClick={mobileBack} aria-label="back" style={{ flex: "none", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #C4818F", background: "#FDF5E4", cursor: "pointer", color: "#9E4B54" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49", lineHeight: 1.1 }}>{cafeName}</div>
                <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".12em", color: "#B07B6A", marginTop: 3 }}>{stepLabel}</div>
              </div>
              <span style={{ flex: "none", display: "flex", border: "2px solid #9E4B54" }}>
                {(["th", "en"] as Lang[]).map((l) => (
                  <button key={l} onClick={() => setLang(l)} style={{ ...segBtn(lang === l), fontSize: 9, padding: "8px 9px" }}>{l.toUpperCase()}</button>
                ))}
              </span>
            </div>
            {screen === "counter" && (
              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <div style={{ position: "relative", flex: "none", width: 88, height: 88, border: "3px solid #DBB79A", background: portraitBgMobile, overflow: "hidden" }}>
                  {portraitImgMobile && (
                    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local/optimizable asset
                    <img src={portraitImgMobile} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, border: "3px solid #9E4B54", background: "#FFF9EC", padding: "8px 10px" }}>
                  <div style={{ fontFamily: dot, fontSize: 14, color: "#9E4B54" }}>Naire</div>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, minHeight: "4.5em", color: "#6B4535", textWrap: "pretty" }}>{typed}<span className="anim-caret" style={{ color: "#9E4B54" }}>▍</span></p>
                </div>
              </div>
            )}
          </div>

          {/* ── COUNTER ── */}
          {screen === "counter" && (
            <>
              <div data-pixel-scroll style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: "12px 12px 18px" }}>
                {/* slip card (name + menu + amount + tts + note) */}
                <div style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: 12, display: "flex", flexDirection: "column", gap: 11 }}>
                  <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{c.slipLabel}</div>

                  {/* name + anonymous */}
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656", marginBottom: 5 }}>{c.nameLabel}</div>
                    <input value={anon ? "" : name} disabled={anon} onChange={(e) => setName(e.target.value)} onFocus={() => setNameFocus(true)} onBlur={() => setNameFocus(false)} maxLength={30} autoComplete="username" placeholder={c.anonName}
                      style={{ width: "100%", padding: 12, border: `3px solid ${nameFocus ? "#9E4B54" : "#DBB79A"}`, background: anon ? "#F1E6D3" : "#FFF", fontSize: 15, color: "#7A3F49", outline: "none" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 4 }}>
                      <button onClick={() => setAnon(!anon)} role="checkbox" aria-checked={anon}
                        style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 44, border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "#7A3F49", fontSize: 13 }}>
                        <span style={{ flex: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #9E4B54", background: anon ? "#FDD3E0" : "#FFF" }}>
                          {anon && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                        </span>
                        <span>{c.anonLabel}</span>
                      </button>
                      <Info open={anonTip} setOpen={setAnonTip} text={c.anonTip} />
                    </div>
                  </div>

                  {/* menu */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{c.menuTitle}</div>
                      <div style={{ flex: "none", display: "flex", gap: 3, padding: 3, background: "#EEDCBE", border: "2px solid #DBB79A" }}>
                        {CURRENCIES.map((cc) => (
                          <button key={cc.code} onClick={() => changeCurrency(cc.code)} style={{ ...curChip(cur === cc.code), fontSize: 9, padding: "6px 7px" }}>{cc.code}</button>
                        ))}
                      </div>
                    </div>
                    {allTags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                        <button onClick={() => setTagFilter("")} style={tagChip(tagFilter === "")}>{c.tagAll}</button>
                        {allTags.map((tag) => (
                          <button key={tag} onClick={() => setTagFilter(tag)} style={tagChip(tagFilter === tag)}>{tag}</button>
                        ))}
                      </div>
                    )}
                    {/* treats on shelves — 4-col, lift + glow on select (mobile prototype) */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "18px 8px", padding: "12px 5px 0", margin: "0 -4px 4px" }}>
                      {shownMenu.map((t) => {
                        const on = itemId === t.id;
                        return (
                          <button key={t.id} onClick={() => pickTreat(t)} aria-label={t[lang]} className="pixel-press"
                            style={{ position: "relative", zIndex: on ? 5 : 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 9px", cursor: "pointer", textAlign: "center", border: "none", background: "none" }}>
                            {/* tile */}
                            <span style={{ position: "relative", zIndex: 2, display: "block", width: "100%", boxSizing: "border-box", transformOrigin: "50% 100%", background: on ? TILE_ON_BG : "transparent", boxShadow: on ? TILE_ON_GLOW : "none", transform: on ? "translate(0,-5px) scale(1.07)" : "translate(0,0) scale(1)" }}>
                              <span style={{ display: "block", width: "90%", margin: "0 auto", aspectRatio: "1 / 1", overflow: "hidden", background: treatThumbBg(t) }} aria-hidden />
                              <span style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: on ? "inset 0 0 0 2px rgba(255,255,255,.65)" : "none" }} />
                            </span>
                            {/* shelf */}
                            <span style={{ position: "relative", display: "block", width: "calc(100% + 8px)", marginLeft: -4, zIndex: 1, height: 5, background: on ? "#E0AE7B" : "#C79A6E", boxShadow: `0 3px 0 ${on ? "#B07C52" : "#9C7350"},0 5px 0 rgba(150,116,82,.28)${on ? ",0 0 17px 4px rgba(255,196,110,.6)" : ""}` }} />
                            {/* price tag */}
                            <span style={{ position: "relative", zIndex: 3, marginTop: -3, display: "block", fontFamily: mono, fontSize: 10, lineHeight: 1, whiteSpace: "nowrap", padding: "4px 6px", background: on ? "#9E4B54" : "#FFF9EC", color: on ? "#FFF1E2" : "#7A3F49", border: `2px solid ${on ? "#6B2F3A" : "#C79A6E"}`, transform: on ? "rotate(-4deg) scale(1.08)" : "rotate(0) scale(1)", boxShadow: on ? "2px 3px 0 #6B2F3A" : "none" }}>{fmtDisplay(t.price, cur)}</span>
                            {/* name */}
                            <span style={{ display: "block", marginTop: 7, fontFamily: dot, fontSize: 11, lineHeight: 1.25, color: on ? "#9E4B54" : "#7A5C4B", fontWeight: on ? 700 : 400, textWrap: "pretty" }}>{t[lang]}</span>
                          </button>
                        );
                      })}
                      {/* filler shelves to complete the last row of four */}
                      {Array.from({ length: (4 - (shownMenu.length % 4)) % 4 }).map((_, i) => (
                        <div key={`filler-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 9px" }}>
                          <span style={{ display: "block", width: "90%", margin: "0 auto", aspectRatio: "1 / 1" }} />
                          <span style={{ display: "block", width: "calc(100% + 8px)", marginLeft: -4, height: 5, background: "#C79A6E", boxShadow: "0 3px 0 #9C7350,0 5px 0 rgba(150,116,82,.28)" }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* amount */}
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.amountLabel}</span>
                      {selected && <span style={{ fontSize: 12, color: "#7A3F49" }}>{selected[lang]}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", border: `3px solid ${amtErr ? "#C4646F" : amtFocus || !itemId ? "#9E4B54" : "#DBB79A"}`, background: "#FFF" }}>
                      <span style={{ fontFamily: dot, fontSize: 17, color: "#9E4B54" }}>{symbol}</span>
                      <input value={amount} onChange={(e) => handleAmount(e.target.value)} onFocus={() => setAmtFocus(true)} onBlur={() => setAmtFocus(false)} inputMode="decimal" placeholder={c.customPlaceholder}
                        style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", padding: "12px 0", fontFamily: dot, fontSize: 19, color: "#7A3F49" }} />
                    </div>
                    {amtErr && <div style={{ ...errBlock, marginTop: 6 }}>{amtErrMsg}</div>}
                  </div>

                  {/* tts meter */}
                  {realVoiceOn && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.ttsLabel}</span>
                        <span style={{ fontSize: 11, color: ttsUnlocked ? "#7A4A94" : "#8E6B5B" }}>{ttsUnlocked ? c.ttsUnlocked : c.ttsToGo(fmtDisplay(Math.max(0, ttsThreshold - totalThb), cur))}</span>
                      </div>
                      <div style={{ height: 10, border: "2px solid #9E4B54", background: "#E7D2B0", padding: 2 }}>
                        <div style={{ height: "100%", background: "repeating-linear-gradient(90deg,#C9A2D6 0 5px,#B98FC8 5px 10px)", width: `${ttsPct}%`, transition: "width .35s steps(8)" }} />
                      </div>
                    </div>
                  )}

                  {/* note + keep private */}
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.noteLabel}</span>
                      <span style={{ fontFamily: mono, fontSize: 9, color: "#B07B6A" }}>{message.length}/250</span>
                    </div>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 250))} onFocus={() => setMsgFocus(true)} onBlur={() => setMsgFocus(false)} rows={3} placeholder={c.notePlaceholder}
                      style={{ width: "100%", padding: "10px 12px", border: `3px solid ${msgFocus ? "#9E4B54" : "#DBB79A"}`, background: "#FFF", fontSize: 14, lineHeight: 1.55, color: "#7A3F49", outline: "none", resize: "none" }} />
                    {sealedAllowed && (
                      <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 4 }}>
                        <button onClick={() => setPriv((p) => !p)} role="checkbox" aria-checked={priv}
                          style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 44, border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "#7A3F49", fontSize: 13 }}>
                          <span style={{ flex: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #9E4B54", background: priv ? "#FDD3E0" : "#FFF" }}>
                            {priv && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                          </span>
                          <span>{c.privLabel}</span>
                        </button>
                        <Info open={privTip} setOpen={setPrivTip} text={c.privTip} />
                      </div>
                    )}
                  </div>
                </div>

                {/* café goal */}
                {goal.showOnCounter && (
                  <div style={{ borderTop: "3px dashed #DBB79A", paddingTop: 12 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", border: "3px solid #DBB79A", background: "#F7E7CB", padding: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.goalLabel}</div>
                        <div style={{ fontSize: 12.5, color: "#7A3F49", marginTop: 2 }}>{goal.label || c.goalItem}</div>
                        <div style={{ marginTop: 7, height: 14, border: "3px solid #9E4B54", background: "#E7D2B0", padding: 2, display: "flex" }}>
                          <div style={{ height: "100%", flex: "none", background: "repeating-linear-gradient(90deg,#F4A9BD 0 6px,#EE93AB 6px 12px)", transition: "width .35s steps(8)", width: `${goalPct}%` }} />
                          <div className="anim-goalprev" style={{ height: "100%", flex: "none", width: `${previewPct}%`, background: "repeating-linear-gradient(90deg,#9E4B54 0 4px,rgba(158,75,84,.2) 4px 8px)", transition: "width .35s steps(8)" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>
                          <span>{baht(goal.raisedThb)}</span>
                          <span style={{ color: "#B07B6A" }}>{Math.round(goalPctShown)}% / {baht(goal.targetThb)}</span>
                        </div>
                        {goal.deadline && <div style={{ marginTop: 4, fontSize: 10.5, color: "#8E6B5B" }}>{c.goalUntil(fmtGoalDeadline(goal.deadline))}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* sticky total + checkout */}
              <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#FDF5E4", borderTop: "3px solid #9E4B54" }}>
                <span style={{ flex: "none" }}>
                  <span style={{ display: "block", fontFamily: mono, fontSize: 8, letterSpacing: ".12em", color: "#B07B6A" }}>{c.totalLabel}</span>
                  <span style={{ display: "block", fontFamily: dot, fontSize: 22, color: "#9E4B54", lineHeight: 1.1 }}>{totalThb > 0 ? totalDisplayLabel : fmtDisplay(0, cur)}</span>
                </span>
                <button onClick={goCheckout} className="pixel-press" style={{ flex: 1, minWidth: 0, minHeight: 48, padding: "14px 10px", border: "4px solid #7A3F49", background: "repeating-linear-gradient(90deg,#F4A9BD 0 10px,#F0A0B5 10px 20px)", color: "#6B2F3A", fontFamily: dot, fontSize: 16, cursor: "pointer", boxShadow: "0 5px 0 #9E4B54" }}>{c.ctaShort}</button>
              </div>
            </>
          )}

          {/* ── PAY ── */}
          {screen === "pay" && (
            <div data-pixel-scroll style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, paddingBottom: 10, borderBottom: "3px dashed #DBB79A" }}>
                <span>
                  <span style={{ display: "block", fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: "#9A6656" }}>{c.payTitle}</span>
                  <span style={{ display: "block", fontFamily: dot, fontSize: 17, color: "#7A3F49", marginTop: 3 }}>{orderSummary}</span>
                </span>
                {/* The total lives on the PromptPay ticket itself below — showing it
                    twice reads as noise, so it only appears here for card payment. */}
                {!showPromptPay && (
                  <span style={{ textAlign: "right", flex: "none" }}>
                    <span style={{ display: "block", fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{c.payAmount}</span>
                    <span style={{ display: "block", fontFamily: dot, fontSize: 26, color: "#9E4B54", lineHeight: 1.1 }}>{totalDisplayLabel}</span>
                  </span>
                )}
              </div>

              {/* method */}
              <div>
                <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656", marginBottom: 6 }}>{c.methodLabel}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button onClick={() => promptPayAvailable && setMethod("promptpay")} disabled={!promptPayAvailable} style={{ ...methodCard(showPromptPay), ...(promptPayAvailable ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}>
                    <QrCode size={22} strokeWidth={2.25} color="#9E4B54" />
                    <span style={{ fontFamily: dot, fontSize: 14, color: "#7A3F49" }}>{c.ppName}</span>
                    <span style={{ fontSize: 11, color: promptPayAvailable ? "#8E6B5B" : "#C4646F" }}>{promptPayAvailable ? c.ppSub : c.ppThbOnly}</span>
                  </button>
                  <button onClick={() => setMethod("card")} style={methodCard(method === "card")}>
                    <CreditCard size={22} strokeWidth={2.25} color="#9E4B54" />
                    <span style={{ fontFamily: dot, fontSize: 14, color: "#7A3F49" }}>{c.cdName}</span>
                    <span style={{ fontSize: 11, color: "#8E6B5B" }}>Visa · Mastercard</span>
                  </button>
                </div>
              </div>

              {/* email */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 5 }}>
                  <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.emailLabel}</span>
                  <Info open={mailTip} setOpen={setMailTip} text={c.mailTip} />
                </div>
                <input value={email} onChange={(e) => { setEmail(e.target.value); setMailErr(false); }} inputMode="email" autoComplete="email" placeholder="you@email.com"
                  style={{ width: "100%", padding: 12, border: `3px solid ${mailErr ? "#C4646F" : "#DBB79A"}`, background: "#FFF", fontSize: 15, color: "#7A3F49", outline: "none" }} />
                {mailErr && <div style={{ ...errBlock, marginTop: 6 }}>{c.errEmail}</div>}
              </div>

              {showPromptPay ? (
                <div style={{ border: "4px solid #7A3F49", background: "#FFFBF2", boxShadow: "0 6px 0 #9E4B54" }}>
                  {/* ticket header strip — who the money's going to. Always English:
                      this card is the thing payers screenshot/save, so it should read
                      the same no matter which language the rest of the page is in. */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 14px", background: "#7A3F49" }}>
                    <span style={{ fontFamily: dot, fontSize: 13, color: "#FFF6E2", letterSpacing: ".02em" }}>{qc.qrPayTo(STREAMER_NAME)}</span>
                  </div>

                  <div style={{ position: "relative", padding: 18 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, filter: emailOk && qrImageUrl && qrSecondsLeft !== 0 ? "none" : "blur(7px)", opacity: emailOk && qrImageUrl && qrSecondsLeft !== 0 ? 1 : 0.55, transition: "filter .25s steps(4),opacity .25s steps(4)" }}>
                      {/* padding is the real gap to the border — it lives on this
                          box, but clipping the zoomed QR happens one level in, so
                          the crop can't bleed back out over that gap. */}
                      <div style={{ flex: "none", width: "calc(min(72vw, 260px) * 0.8)", aspectRatio: "1 / 1", border: "3px solid #9E4B54", background: "#FFF", display: "grid", placeItems: "center" }}>
                        <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                          {qrImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrImageUrl} alt="PromptPay QR" style={{ width: "100%", height: "100%", transform: "scale(1.2)" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", backgroundImage: "repeating-conic-gradient(#7A3F49 0% 25%, #FFF 0% 50%)", backgroundSize: "16px 16px" }} />
                          )}
                        </div>
                      </div>
                      {qrImageUrl && (
                        <button onClick={saveQr} disabled={qrSaving} className="pixel-press" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, padding: "10px 18px", border: "3px solid #9E4B54", background: qrSaved ? "#EAF6EC" : "#FDD3E0", color: qrSaved ? "#3F7A4E" : "#7A3F49", fontFamily: mono, fontSize: 11, letterSpacing: ".06em", cursor: qrSaving ? "default" : "pointer" }}>
                          {qrSaved ? <Check size={16} strokeWidth={2.5} /> : <Download size={16} strokeWidth={2.25} />}
                          {qrSaved ? qc.qrSavedBtn : qc.saveQrBtn}
                        </button>
                      )}

                      {/* ticket tear line */}
                      <div style={{ width: "100%", borderTop: "3px dashed #DBB79A" }} />

                      {/* receipt line items — total + expiry, always English */}
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".1em", color: "#9A6656" }}>{qc.qrTotalLabel}</span>
                          <span style={{ fontFamily: dot, fontSize: 24, color: "#9E4B54", lineHeight: 1 }}>{totalDisplayLabel}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".1em", color: "#9A6656" }}>{qc.qrExpiryLabel}</span>
                          <span style={{ fontFamily: mono, fontSize: 12, letterSpacing: ".02em", color: qrSecondsLeft !== null && qrSecondsLeft <= 60 ? "#C4646F" : "#7A3F49" }}>
                            {qrExpiresAt ? fmtExpiry(new Date(qrExpiresAt)) : "—"}
                          </span>
                        </div>
                      </div>

                      <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "#8E6B5B", textAlign: "center", textWrap: "pretty" }}>{qc.qrBody}</div>
                    </div>
                    {emailOk && qrImageUrl && qrSecondsLeft === 0 && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, textAlign: "center", background: "rgba(253,245,228,.9)" }}>
                        <div style={{ fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{qc.qrExpired}</div>
                        <button onClick={retryQr} style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".08em", padding: "9px 16px", border: "3px solid #9E4B54", background: "#FDD3E0", color: "#7A3F49", cursor: "pointer" }}>{qc.tryAgainBtn}</button>
                      </div>
                    )}
                    {!emailOk && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, padding: 16, textAlign: "center", background: "rgba(253,245,228,.86)" }}>
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        <div style={{ fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{qc.qrLockTitle}</div>
                        <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.6, color: "#8E6B5B", textWrap: "pretty" }}>{qc.qrLockBody}</div>
                      </div>
                    )}
                    {emailOk && (
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", border: "2px solid #7FB98B", background: "#EAF6EC", fontSize: 12, lineHeight: 1.4, color: "#3F7A4E" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4E9E63" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><path d="M20 6 9 17l-5-5" /></svg>
                        <span style={{ minWidth: 0, textWrap: "pretty" }}>{qc.qrSent(email.trim())}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <Elements key={`${chargeCurrency}-${chargeAmount}`} stripe={stripePromise} options={elementsOptions}>
                  <CardForm lang={lang} name={anon ? c.anonName : name} amount={chargeAmount} currency={chargeCurrency} displayCur={cur} payLabel={totalDisplayLabel} message={message} keepSecret={priv} email={email} itemId={itemId}
                    getIdempotencyKey={getIdempotencyKey} onSaveContact={saveContact} onPaid={(pi) => { setPaymentIntentId(pi); setScreen("receipt"); loadSupporters(); }} />
                </Elements>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: mono, fontSize: 9, color: "#B07B6A" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {c.secureNote}
              </div>
            </div>
          )}

          {/* ── RECEIPT (same paid-banner + share-story builder as desktop) ── */}
          {screen === "receipt" && (
            <div data-pixel-scroll style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 12px 24px", display: "flex", flexDirection: "column", gap: 14, alignItems: "stretch" }}>
              {/* paid banner */}
              <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#7A3F49", boxShadow: "inset 0 0 0 4px #9E4B54,0 6px 0 rgba(107,47,58,.45)", padding: "14px 14px" }}>
                <span style={{ flex: "none", width: 48, height: 48, display: "grid", placeItems: "center", background: "#FDD3E0", boxShadow: "inset 0 0 0 3px #FFF1E2", color: "#7A3F49" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontFamily: dot, fontSize: 20, lineHeight: 1.1, color: "#FFF6E2" }}>{c.paidTitle}</span>
                  <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "#FACDD4", textWrap: "pretty" }}>{c.paidSub(email.trim() || "—")}</span>
                </span>
                <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span style={{ fontFamily: dot, fontSize: 22, lineHeight: 1, padding: "5px 9px", background: "#FDD3E0", color: "#7A3F49" }}>{fmtDisplay(totalThb, cur)}</span>
                  <span style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: ".1em", color: "#F2D9C6" }}>{c.orderNoLabel} {receiptNo}</span>
                  <span style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: ".1em", color: "#C99AA0" }}>{stamp}</span>
                </span>
              </div>

              {/* thank-you message — Voice panel's editable thanks template */}
              <div style={{ width: "100%", padding: "12px 14px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #E9A9B8" }}>
                <span style={{ fontSize: 13, lineHeight: 1.6, color: "#6B2F3A", textWrap: "pretty" }}>{thanksMessage}</span>
              </div>

              {/* share-story builder */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, background: "#FFF9EC", border: "3px solid #DBB79A", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontFamily: dot, fontSize: 19, color: "#7A3F49" }}>{c.shareTitle}</span>
                </div>
                {/* 9:16 story preview */}
                <div style={{ alignSelf: "center", width: 248, position: "relative", aspectRatio: "9 / 16", overflow: "hidden", background: "#7A3F49", boxShadow: "inset 0 0 0 3px #9E4B54" }}>
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(95,58,64,.6) 0%,rgba(95,58,64,.16) 32%,rgba(58,30,36,.8) 100%)" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "11px 11px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 19, height: 19, background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #FFF1E2", display: "grid", placeItems: "center", fontSize: 9 }}>✿</span>
                      <span style={{ fontFamily: dot, fontSize: 11, color: "#FFF1E2" }}>{cafeName}</span>
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".1em", color: "#F2D9C6" }}>{stamp}</span>
                  </div>
                  <div style={{ position: "absolute", left: 11, right: 11, bottom: 11, display: "flex", flexDirection: "column", gap: 9 }}>
                    <span style={{ width: 84, height: 84, background: "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)", boxShadow: "0 0 0 3px #FFF1E2,0 0 0 6px #9E4B54" }} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: ".14em", color: "#F4A9BD" }}>{c.shareKicker}</span>
                      <span style={{ fontFamily: dot, fontSize: 18, lineHeight: 1.15, color: "#FFF6E2", textWrap: "pretty" }}>{orderSummary}</span>
                      {shareAmount && <span style={{ display: "inline-flex", alignSelf: "flex-start", fontFamily: mono, fontSize: 11, lineHeight: 1, padding: "5px 8px", background: "#FDD3E0", color: "#7A3F49", boxShadow: "0 3px 0 #9E4B54" }}>{fmtDisplay(totalThb, cur)}</span>}
                    </span>
                    {shareNote && message.trim() && (
                      <span style={{ display: "flex", gap: 7, padding: "8px 9px", background: "rgba(253,245,228,.94)", boxShadow: "inset 0 0 0 2px #E9A9B8" }}>
                        <span style={{ flex: "none", width: 7, height: 7, marginTop: 4, background: "#F4A9BD" }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.55, color: "#6B2F3A", textWrap: "pretty" }}>{message.trim()}</span>
                      </span>
                    )}
                    {canShareGoal && (
                      <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".12em", color: "#F2D9C6" }}>{c.goalLabel}</span>
                          <span style={{ fontFamily: mono, fontSize: 8, color: "#FFF1E2" }}>{fmtDisplay(goal.raisedThb + totalThb, cur)} / {fmtDisplay(goal.targetThb, cur)}</span>
                        </span>
                        <span style={{ display: "block", height: 9, background: "rgba(253,245,228,.26)", boxShadow: "inset 0 0 0 2px rgba(255,241,226,.5)", padding: 2 }}>
                          <span style={{ display: "block", height: "100%", background: "repeating-linear-gradient(90deg,#F4A9BD 0 5px,#EE93AB 5px 10px)", width: `${Math.min(100, ((goal.raisedThb + totalThb) / goal.targetThb) * 100)}%` }} />
                        </span>
                      </span>
                    )}
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#FDD3E0" }}>{SHARE_HANDLE}</span>
                      <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".1em", color: "#F2D9C6" }}>{c.shareCta}</span>
                    </span>
                  </div>
                </div>
                {/* controls */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#8E6B5B", textWrap: "pretty" }}>{c.shareHint}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <ShareToggle label={c.shareTogAmount} on={shareAmount} onClick={() => setShareAmount((v) => !v)} />
                    {message.trim() && <ShareToggle label={c.shareTogNote} on={shareNote} onClick={() => setShareNote((v) => !v)} />}
                    {goal.showOnShare && <ShareToggle label={c.shareTogGoal} on={shareGoal} onClick={() => setShareGoal((v) => !v)} />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <button onClick={saveStory} className="pixel-press" style={{ width: "100%", minHeight: 48, padding: 13, background: "#9E4B54", color: "#FFF1E2", boxShadow: "0 5px 0 #6B2F3A", fontFamily: dot, fontSize: 16 }}>{c.shareSave}</button>
                    <button onClick={copyShareLink} style={{ width: "100%", minHeight: 44, padding: 11, background: "#FFF1E2", color: "#7A3F49", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 13 }}>{copied ? c.shareCopied : c.shareCopy}</button>
                  </div>
                </div>
              </div>

              {/* footer */}
              <button onClick={resetAll} style={{ width: "100%", minHeight: 46, padding: 13, background: "#FDD3E0", boxShadow: "inset 0 0 0 3px #9E4B54,0 5px 0 #C4818F", fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{c.backCafe}</button>
              <a href="mailto:hello@nairelie.cafe" style={{ fontSize: 12, color: "#C4818F", textAlign: "center" }}>{c.paidHelp}</a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#5F3A40" }}>
      {curtain}
      <section style={{ minHeight: "100%", padding: 40, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18, minWidth: 1260 }}>
        <div style={{ position: "relative", width: 1180, border: "5px solid #C4818F", background: "#F7E7CB", padding: 16, boxShadow: "0 0 0 4px #7A3F49, 0 16px 34px rgba(0,0,0,.3)", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* header */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 12, borderBottom: "3px dashed #DBB79A" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 34, height: 34, background: "#FDD3E0", border: "3px solid #9E4B54", display: "grid", placeItems: "center", fontSize: 15 }}>✿</span>
              <div>
                <div style={{ fontFamily: dot, fontSize: 22, lineHeight: 1.1, color: "#7A3F49" }}>{cafeName}</div>
                <div style={{ fontSize: 12, color: "#A6806F", marginTop: 1 }}>{c.tagline}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: "#B07B6A" }}>✿ {c.flowerLabel} · {flowerLine}</span>
              <span style={{ display: "flex", border: "3px solid #9E4B54" }}>
                {(["th", "en"] as Lang[]).map((l) => (
                  <button key={l} onClick={() => setLang(l)} style={segBtn(lang === l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
          </div>

          {/* body: left rail + right pane */}
          <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
            {/* left rail */}
            <div style={{ flex: "0 0 330px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ position: "relative", flex: "none", aspectRatio: "3 / 4", border: "3px solid #DBB79A", background: portraitBgDesktop, overflow: "hidden" }}>
                {portraitImgDesktop && (
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local/optimizable asset
                  <img src={portraitImgDesktop} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
              <div style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "14px 16px 10px", position: "relative" }}>
                <div style={{ fontFamily: dot, fontSize: 17, color: "#9E4B54" }}>Naire</div>
                <p style={{ margin: "5px 0 0", fontSize: 14, lineHeight: 1.7, minHeight: "5.1em", color: "#6B4535", textWrap: "pretty" }}>
                  {typed}
                  <span className="anim-caret" style={{ color: "#9E4B54" }}>▍</span>
                </p>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button onClick={nextLine} aria-label="next line" className="anim-arrow" style={{ border: "none", background: "none", color: "#9E4B54", fontSize: 14, cursor: "pointer", padding: "2px 14px", width: "auto" }}>▼</button>
                </div>
              </div>
            </div>

            {/* right pane */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {screen === "counter" && (
                <div style={{ flex: 1, display: "flex", gap: 12, alignItems: "stretch" }}>
                  {/* menu column */}
                  <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontFamily: dot, fontSize: 19, color: "#7A3F49" }}>{c.menuTitle}</div>
                      <div style={{ display: "flex", gap: 4, padding: 3, background: "#EEDCBE", border: "3px solid #DBB79A" }}>
                        {CURRENCIES.map((cc) => (
                          <button key={cc.code} onClick={() => changeCurrency(cc.code)} style={curChip(cur === cc.code)}>
                            {cc.code}
                          </button>
                        ))}
                      </div>
                    </div>

                    {allTags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button onClick={() => setTagFilter("")} style={tagChip(tagFilter === "")}>{c.tagAll}</button>
                        {allTags.map((tag) => (
                          <button key={tag} onClick={() => setTagFilter(tag)} style={tagChip(tagFilter === tag)}>{tag}</button>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: menuCols, gap: 10 }}>
                      {shownMenu.map((t) => {
                        const on = itemId === t.id;
                        return (
                          <button key={t.id} onClick={() => pickTreat(t)} aria-label={t[lang]} style={treatCard(on)}>
                            <span style={{ width: "100%", aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 11, background: treatThumbBg(t) }} aria-hidden />
                            <span style={{ fontFamily: dot, fontSize: 12, lineHeight: 1.15, textAlign: "center", color: on ? "#9E4B54" : "#7A5C4B", fontWeight: on ? 700 : 400, textWrap: "pretty", paddingBottom: 2 }}>{t[lang]}</span>
                            <span style={pricePill(on)}>{fmtDisplay(t.price, cur)}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* café goal card — under the menu only while it fits (see goalBelowSlip) */}
                    {goal.showOnCounter && !goalBelowSlip && goalCardDesktop(8)}
                  </div>

                  {/* order slip (+ the goal card when the menu grew too tall for it) */}
                  <div style={{ flex: "0 0 330px", minWidth: 0, alignSelf: "flex-start", display: "flex", flexDirection: "column" }}>
                    <div style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "22px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
                      <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: ".1em", color: "#B07B6A", textAlign: "center" }}>{c.slipLabel}</div>

                      {/* name + anonymous */}
                      <div>
                        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: ".1em", color: "#9A6656", marginBottom: 5 }}>{c.nameLabel}</div>
                        <input value={anon ? "" : name} disabled={anon} onChange={(e) => setName(e.target.value)} onFocus={() => setNameFocus(true)} onBlur={() => setNameFocus(false)} maxLength={30} autoComplete="username" placeholder={c.anonName}
                          style={{ width: "100%", padding: "10px 12px", border: `3px solid ${nameFocus ? "#9E4B54" : "#DBB79A"}`, background: anon ? "#F1E6D3" : "#FFF", fontSize: 14, color: "#7A3F49", outline: "none" }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 8 }}>
                          <button onClick={() => setAnon(!anon)} role="checkbox" aria-checked={anon}
                            style={{ display: "flex", alignItems: "flex-start", gap: 8, border: "none", background: "none", padding: "5px 2px", cursor: "pointer", textAlign: "left", color: "#7A3F49", fontSize: 12, width: "auto" }}>
                            <span style={{ flex: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #9E4B54", background: anon ? "#FDD3E0" : "#FFF" }}>
                              {anon && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                            </span>
                            <span style={{ lineHeight: "20px" }}>{c.anonLabel}</span>
                          </button>
                          <Info open={anonTip} setOpen={setAnonTip} text={c.anonTip} />
                        </div>
                      </div>

                      {/* amount */}
                      <div>
                        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".1em", color: "#9A6656", marginBottom: 5 }}>{c.amountLabel}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `3px solid ${amtErr ? "#C4646F" : amtFocus || !itemId ? "#9E4B54" : "#DBB79A"}`, background: "#FFF" }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#9E4B54" }}>{symbol}</span>
                          <input value={amount} onChange={(e) => handleAmount(e.target.value)} onFocus={() => setAmtFocus(true)} onBlur={() => setAmtFocus(false)} inputMode="decimal" placeholder={c.customPlaceholder}
                            style={{ flex: 1, minWidth: 0, border: "none", background: "none", outline: "none", fontFamily: dot, fontSize: 18, color: "#7A3F49" }} />
                        </div>
                        {amtErr && <div style={{ ...errBlock, marginTop: 6 }}>{amtErrMsg}</div>}
                        {/* TTS meter */}
                        {realVoiceOn && (
                          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 8 }}>
                            <div style={{ flex: 1, height: 10, border: "2px solid #DBB79A", background: "#EEDCBE", padding: 1 }}>
                              <div style={{ height: "100%", background: "repeating-linear-gradient(90deg,#C9A2D6 0 5px,#B98FC8 5px 10px)", transition: "width .35s steps(8)", width: `${ttsPct}%` }} />
                            </div>
                            <span style={{ flex: "none", fontSize: 11, color: ttsUnlocked ? "#7A4A94" : "#8E6B5B" }}>
                              {ttsUnlocked ? c.ttsUnlocked : c.ttsToGo(fmtDisplay(Math.max(0, ttsThreshold - totalThb), cur))}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* note */}
                      <div>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: ".1em", color: "#9A6656" }}>{c.noteLabel}</span>
                          <span style={{ fontFamily: mono, fontSize: 9, color: "#B07B6A" }}>{message.length}/250</span>
                        </div>
                        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 250))} onFocus={() => setMsgFocus(true)} onBlur={() => setMsgFocus(false)} rows={3} placeholder={c.notePlaceholder}
                          style={{ width: "100%", padding: "10px 12px", border: `3px solid ${msgFocus ? "#9E4B54" : "#DBB79A"}`, background: "#FFF", fontSize: 13.5, lineHeight: 1.6, color: "#7A3F49", outline: "none", resize: "none" }} />
                        {sealedAllowed && (
                          <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 8 }}>
                            <button onClick={() => setPriv((p) => !p)} role="checkbox" aria-checked={priv}
                              style={{ display: "flex", alignItems: "flex-start", gap: 8, border: "none", background: "none", padding: "5px 2px", cursor: "pointer", textAlign: "left", color: "#7A3F49", fontSize: 12, width: "auto" }}>
                              <span style={{ flex: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #9E4B54", background: priv ? "#FDD3E0" : "#FFF" }}>
                                {priv && (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                                )}
                              </span>
                              <span style={{ lineHeight: "20px" }}>{c.privLabel}</span>
                            </button>
                            <Info open={privTip} setOpen={setPrivTip} text={c.privTip} />
                          </div>
                        )}
                      </div>

                      <button onClick={goCheckout} style={ctaBtn}>
                        {totalThb > 0 ? c.cta(totalDisplayLabel) : c.ctaEmpty}
                      </button>
                    </div>
                    {goal.showOnCounter && goalBelowSlip && goalCardDesktop(10, true)}
                  </div>
                </div>
              )}

              {screen === "pay" && (
                <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
                  <div style={{ width: 640, maxWidth: "100%", border: "3px solid #9E4B54", background: "#FDF5E4", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingBottom: 12, borderBottom: "3px dashed #DBB79A" }}>
                      <div>
                        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".14em", color: "#9A6656" }}>{c.payTitle}</div>
                        <div style={{ fontFamily: dot, fontSize: 20, color: "#7A3F49", marginTop: 4 }}>{orderSummary}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.payAmount}</div>
                        <div style={{ fontFamily: dot, fontSize: 30, color: "#9E4B54", lineHeight: 1.1 }}>{totalDisplayLabel}</div>
                      </div>
                    </div>

                    {/* method */}
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656", marginBottom: 6 }}>{c.methodLabel}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <button onClick={() => promptPayAvailable && setMethod("promptpay")} disabled={!promptPayAvailable} style={{ ...methodCard(showPromptPay), ...(promptPayAvailable ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}>
                          <QrCode size={20} strokeWidth={2.25} color="#9E4B54" />
                          <span style={{ fontFamily: dot, fontSize: 15, color: "#7A3F49" }}>{c.ppName}</span>
                          <span style={{ fontSize: 11.5, color: promptPayAvailable ? "#8E6B5B" : "#C4646F" }}>{promptPayAvailable ? c.ppSub : c.ppThbOnly}</span>
                        </button>
                        <button onClick={() => setMethod("card")} style={methodCard(method === "card")}>
                          <CreditCard size={20} strokeWidth={2.25} color="#9E4B54" />
                          <span style={{ fontFamily: dot, fontSize: 15, color: "#7A3F49" }}>{c.cdName}</span>
                          <span style={{ fontSize: 11.5, color: "#8E6B5B" }}>Visa · Mastercard</span>
                        </button>
                      </div>
                    </div>

                    {/* email */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 5 }}>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9A6656" }}>{c.emailLabel}</span>
                        <Info open={mailTip} setOpen={setMailTip} text={c.mailTip} />
                      </div>
                      <input value={email} onChange={(e) => { setEmail(e.target.value); setMailErr(false); }} inputMode="email" autoComplete="email" placeholder="you@email.com"
                        style={{ width: "100%", padding: "11px 12px", border: `3px solid ${mailErr ? "#C4646F" : "#DBB79A"}`, background: "#FFF", fontSize: 14, color: "#7A3F49", outline: "none" }} />
                      {mailErr && <div style={{ ...errBlock, marginTop: 6 }}>{c.errEmail}</div>}
                    </div>

                    {showPromptPay ? (
                      <>
                        <div style={{ position: "relative", padding: 14, border: "3px solid #DBB79A", background: "#FFF" }}>
                          <div style={{ display: "flex", gap: 16, alignItems: "center", filter: emailOk && qrImageUrl && qrSecondsLeft !== 0 ? "none" : "blur(7px)", opacity: emailOk && qrImageUrl && qrSecondsLeft !== 0 ? 1 : 0.55, transition: "filter .25s steps(4),opacity .25s steps(4)" }}>
                            <div style={{ flex: "none", width: 139, height: 139, border: "3px solid #9E4B54", background: "#FFF", display: "grid", placeItems: "center", overflow: "hidden" }}>
                              {qrImageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={qrImageUrl} alt="PromptPay QR" style={{ width: "100%", height: "100%", transform: "scale(1.2)" }} />
                              ) : (
                                <div style={{ width: "100%", height: "100%", backgroundImage: "repeating-conic-gradient(#7A3F49 0% 25%, #FFF 0% 50%)", backgroundSize: "16px 16px" }} />
                              )}
                            </div>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{c.qrTitle}</div>
                              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#8E6B5B", textWrap: "pretty" }}>{c.qrBody}</div>
                              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".08em", color: qrSecondsLeft !== null && qrSecondsLeft <= 60 ? "#C4646F" : "#B07B6A" }}>
                                {qrSecondsLeft !== null ? c.qrTimer(formatMMSS(qrSecondsLeft)) : c.qrNote}
                              </div>
                            </div>
                          </div>
                          {emailOk && qrImageUrl && qrSecondsLeft === 0 && (
                            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, textAlign: "center", background: "rgba(253,245,228,.9)" }}>
                              <div style={{ fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{c.qrExpired}</div>
                              <button
                                onClick={retryQr}
                                style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".08em", padding: "9px 16px", border: "3px solid #9E4B54", background: "#FDD3E0", color: "#7A3F49", cursor: "pointer" }}
                              >
                                {c.tryAgainBtn}
                              </button>
                            </div>
                          )}
                          {!emailOk && (
                            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, padding: 16, textAlign: "center", background: "rgba(253,245,228,.86)" }}>
                              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#9E4B54" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                              <div style={{ fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{c.qrLockTitle}</div>
                              <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.6, color: "#8E6B5B", textWrap: "pretty" }}>{c.qrLockBody}</div>
                            </div>
                          )}
                          {emailOk && (
                            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", border: "2px solid #7FB98B", background: "#EAF6EC", fontSize: 12, lineHeight: 1.4, color: "#3F7A4E" }}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4E9E63" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><path d="M20 6 9 17l-5-5" /></svg>
                              <span style={{ minWidth: 0, textWrap: "pretty" }}>{c.qrSent(email.trim())}</span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <Elements key={`${chargeCurrency}-${chargeAmount}`} stripe={stripePromise} options={elementsOptions}>
                        <CardForm lang={lang} name={anon ? c.anonName : name} amount={chargeAmount} currency={chargeCurrency} displayCur={cur} payLabel={totalDisplayLabel} message={message} keepSecret={priv} email={email} itemId={itemId}
                          getIdempotencyKey={getIdempotencyKey} onSaveContact={saveContact} onPaid={(pi) => { setPaymentIntentId(pi); setScreen("receipt"); loadSupporters(); }} />
                      </Elements>
                    )}

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <button onClick={backToOrder} style={textBtn}>{c.backEdit}</button>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: "#B07B6A" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        {c.secureNote}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {screen === "receipt" && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                  {/* paid banner */}
                  <div style={{ width: 660, maxWidth: "100%", display: "flex", alignItems: "center", gap: 16, background: "#7A3F49", boxShadow: "inset 0 0 0 4px #9E4B54,0 6px 0 rgba(107,47,58,.45)", padding: "18px 20px" }}>
                    <span style={{ flex: "none", width: 58, height: 58, display: "grid", placeItems: "center", background: "#FDD3E0", boxShadow: "inset 0 0 0 3px #FFF1E2", color: "#7A3F49" }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontFamily: dot, fontSize: 27, lineHeight: 1.1, color: "#FFF6E2" }}>{c.paidTitle}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "#FACDD4", textWrap: "pretty" }}>{c.paidSub(email.trim() || "—")}</span>
                    </span>
                    <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span style={{ fontFamily: dot, fontSize: 28, lineHeight: 1, padding: "5px 10px", background: "#FDD3E0", color: "#7A3F49" }}>{fmtDisplay(totalThb, cur)}</span>
                      <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#F2D9C6" }}>{c.orderNoLabel} {receiptNo}</span>
                      <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#C99AA0" }}>{stamp}</span>
                    </span>
                  </div>

                  {/* thank-you message — Voice panel's editable thanks template */}
                  <div style={{ width: 660, maxWidth: "100%", padding: "12px 16px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #E9A9B8" }}>
                    <span style={{ fontSize: 14, lineHeight: 1.6, color: "#6B2F3A", textWrap: "pretty" }}>{thanksMessage}</span>
                  </div>

                  {/* share-story builder */}
                  <div style={{ width: 660, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 10, background: "#FFF9EC", border: "3px solid #DBB79A", padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontFamily: dot, fontSize: 20, color: "#7A3F49" }}>{c.shareTitle}</span>
                    </div>
                    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
                      {/* 9:16 story preview */}
                      <div style={{ flex: "none", width: 284, position: "relative", aspectRatio: "9 / 16", overflow: "hidden", background: "#7A3F49", boxShadow: "inset 0 0 0 3px #9E4B54" }}>
                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(95,58,64,.6) 0%,rgba(95,58,64,.16) 32%,rgba(58,30,36,.8) 100%)" }} />
                        <div style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "11px 11px 0" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 19, height: 19, background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #FFF1E2", display: "grid", placeItems: "center", fontSize: 9 }}>✿</span>
                            <span style={{ fontFamily: dot, fontSize: 11, color: "#FFF1E2" }}>{cafeName}</span>
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".1em", color: "#F2D9C6" }}>{stamp}</span>
                        </div>
                        <div style={{ position: "absolute", left: 11, right: 11, bottom: 11, display: "flex", flexDirection: "column", gap: 9 }}>
                          <span style={{ width: 84, height: 84, background: "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)", boxShadow: "0 0 0 3px #FFF1E2,0 0 0 6px #9E4B54" }} />
                          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: ".14em", color: "#F4A9BD" }}>{c.shareKicker}</span>
                            <span style={{ fontFamily: dot, fontSize: 18, lineHeight: 1.15, color: "#FFF6E2", textWrap: "pretty" }}>{orderSummary}</span>
                            {shareAmount && <span style={{ display: "inline-flex", alignSelf: "flex-start", fontFamily: mono, fontSize: 11, lineHeight: 1, padding: "5px 8px", background: "#FDD3E0", color: "#7A3F49", boxShadow: "0 3px 0 #9E4B54" }}>{fmtDisplay(totalThb, cur)}</span>}
                          </span>
                          {shareNote && message.trim() && (
                            <span style={{ display: "flex", gap: 7, padding: "8px 9px", background: "rgba(253,245,228,.94)", boxShadow: "inset 0 0 0 2px #E9A9B8" }}>
                              <span style={{ flex: "none", width: 7, height: 7, marginTop: 4, background: "#F4A9BD" }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.55, color: "#6B2F3A", textWrap: "pretty" }}>{message.trim()}</span>
                            </span>
                          )}
                          {canShareGoal && (
                            <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".12em", color: "#F2D9C6" }}>{c.goalLabel}</span>
                                <span style={{ fontFamily: mono, fontSize: 8, color: "#FFF1E2" }}>{fmtDisplay(goal.raisedThb + totalThb, cur)} / {fmtDisplay(goal.targetThb, cur)}</span>
                              </span>
                              <span style={{ display: "block", height: 9, background: "rgba(253,245,228,.26)", boxShadow: "inset 0 0 0 2px rgba(255,241,226,.5)", padding: 2 }}>
                                <span style={{ display: "block", height: "100%", background: "repeating-linear-gradient(90deg,#F4A9BD 0 5px,#EE93AB 5px 10px)", width: `${Math.min(100, ((goal.raisedThb + totalThb) / goal.targetThb) * 100)}%` }} />
                              </span>
                            </span>
                          )}
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#FDD3E0" }}>{SHARE_HANDLE}</span>
                            <span style={{ fontFamily: mono, fontSize: 7, letterSpacing: ".1em", color: "#F2D9C6" }}>{c.shareCta}</span>
                          </span>
                        </div>
                      </div>
                      {/* controls */}
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#8E6B5B", textWrap: "pretty" }}>{c.shareHint}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          <ShareToggle label={c.shareTogAmount} on={shareAmount} onClick={() => setShareAmount((v) => !v)} />
                          {message.trim() && <ShareToggle label={c.shareTogNote} on={shareNote} onClick={() => setShareNote((v) => !v)} />}
                          {goal.showOnShare && <ShareToggle label={c.shareTogGoal} on={shareGoal} onClick={() => setShareGoal((v) => !v)} />}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          <button onClick={saveStory} style={{ width: "100%", minHeight: 48, padding: 13, background: "#9E4B54", color: "#FFF1E2", boxShadow: "0 5px 0 #6B2F3A", fontFamily: dot, fontSize: 16 }}>{c.shareSave}</button>
                          <button onClick={copyShareLink} style={{ width: "100%", minHeight: 42, padding: 11, background: "#FFF1E2", color: "#7A3F49", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 13 }}>{copied ? c.shareCopied : c.shareCopy}</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* footer */}
                  <div style={{ width: 660, maxWidth: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <button onClick={resetAll} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 46, padding: "13px 20px", background: "#FDD3E0", boxShadow: "inset 0 0 0 3px #9E4B54,0 5px 0 #C4818F", fontFamily: dot, fontSize: 16, color: "#7A3F49" }}>{c.backCafe}</button>
                    <a href="mailto:hello@nairelie.cafe" style={{ fontSize: 12, color: "#C4818F" }}>{c.paidHelp}</a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* supporter strip */}
          <div style={{ display: "flex", gap: 16, alignItems: "stretch", paddingTop: 12, borderTop: "3px dashed #DBB79A" }}>
            <div style={{ flex: "0 0 330px", display: "flex", alignItems: "center", gap: 12, border: "3px solid #9E4B54", background: "#FDD3E0", padding: "10px 12px" }}>
              <span style={{ flex: "none", width: 52, height: 52, overflow: "hidden", border: "3px solid #9E4B54", background: "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9E4B54" }}>{c.topLabel}</div>
                <div style={{ fontFamily: dot, fontSize: 19, color: "#7A3F49", lineHeight: 1.2 }}>{topName || "—"}</div>
                <div style={{ fontSize: 11.5, color: "#8E5F63" }}>{topName ? c.topSince(monthName) : "—"}</div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{c.recentLabel}</span>
                <button onClick={() => setShowAll(true)} style={{ display: "flex", alignItems: "center", gap: 5, border: "2px solid #C4818F", background: "#FDF5E4", padding: "5px 9px", cursor: "pointer", fontSize: 11.5, color: "#9E4B54", width: "auto", boxShadow: "none" }}>
                  {c.seeAll}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {recent.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: 8, border: "3px solid #DBB79A", background: "#FDF5E4" }}>
                    <span style={{ flex: "none", width: 34, height: 34, overflow: "hidden", border: "2px solid #DBB79A", background: "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#7A3F49" }}>{s.name}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>{supporterAmount(s.amountMinor, s.currency)}</span>
                      </span>
                      {s.note && <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: "#8E6B5B", marginTop: 3, textWrap: "pretty" }}>{s.note}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {showAll && (
            <div style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(95,58,64,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 26 }}>
              <div style={{ width: 660, maxWidth: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", border: "5px solid #9E4B54", background: "#FDF5E4", boxShadow: "0 0 0 4px #7A3F49,0 18px 34px rgba(0,0,0,.35)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "3px dashed #DBB79A", background: "#FDD3E0" }}>
                  <div>
                    <div style={{ fontFamily: dot, fontSize: 19, color: "#7A3F49", lineHeight: 1.2 }}>{c.guestBook}</div>
                    <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9E4B54", marginTop: 2 }}>{c.guestBookCount(recent.length)}</div>
                  </div>
                  <button onClick={() => setShowAll(false)} aria-label="close" style={{ flex: "none", width: 34, height: 34, display: "grid", placeItems: "center", border: "3px solid #9E4B54", background: "#FDF5E4", cursor: "pointer", color: "#9E4B54", padding: 0, boxShadow: "none" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div data-pixel-scroll style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                  {recent.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: 10, border: "3px solid #DBB79A", background: "#FFF" }}>
                      <span style={{ flex: "none", width: 40, height: 40, overflow: "hidden", border: "2px solid #DBB79A", background: "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#7A3F49" }}>{s.name}</span>
                          <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <span style={{ fontFamily: mono, fontSize: 8, color: "#B07B6A" }}>{relTime(s.createdAt)}</span>
                            <span style={{ fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>{supporterAmount(s.amountMinor, s.currency)}</span>
                          </span>
                        </div>
                        {s.note && <div style={{ fontSize: 12, lineHeight: 1.55, color: "#8E6B5B", marginTop: 3, textWrap: "pretty" }}>{s.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "12px 16px", borderTop: "3px dashed #DBB79A", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "#8E6B5B" }}>{c.guestBookFoot}</span>
                  <button onClick={() => setShowAll(false)} style={{ ...textBtn, border: "3px solid #C4818F", padding: "6px 14px", boxShadow: "0 3px 0 #C4818F" }}>{c.closeLabel}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── boot curtain ────────────────────────────────────────────────────────────
// Shown over the counter until it is genuinely finished assembling (see the
// readiness effects in Cafe). The plum ground is the same colour the pre-mount
// paint already used, so the very first frame the browser draws is the curtain
// itself — nothing flashes on the way in, and the counter crossfades in behind
// it on the way out. Styles live in globals.css under ".boot-curtain".
function CafeCurtain({ lang, steps, leaving }: { lang: Lang; steps: boolean[]; leaving: boolean }) {
  const c = CAFE_COPY[lang];
  // Held back a beat: a warm load finishes inside BOOT_SHOW_MS and the guest
  // sees a plain plum frame instead of a loading state that blinks at them.
  // If the lift starts before the timer fires the cleanup cancels it, so the
  // card never appears just to fade straight back out; once it has appeared it
  // stays for the fade.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (leaving) return;
    const t = setTimeout(() => setVisible(true), BOOT_SHOW_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  // The first unfinished milestone is what the café is busy with right now;
  // -1 means everything landed and the curtain is already on its way up.
  const pending = steps.findIndex((done) => !done);
  const caption = pending === -1 ? c.bootReady : c.bootSteps[pending] ?? c.bootReady;

  return (
    <div className="boot-curtain" data-leaving={leaving} role="status" aria-live="polite" aria-busy={!leaving}>
      <div className="boot-inner" data-show={visible}>
        {/* steam — three stepped columns, disabled under prefers-reduced-motion
            with the rest of the pixel motion vocabulary in globals.css */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 24 }} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="anim-steam" style={{ width: 6, height: 15, background: "#C4818F", opacity: 0, animationDelay: `${i * 0.45}s` }} />
          ))}
        </div>
        {/* cup */}
        <div style={{ position: "relative", width: 64 }} aria-hidden>
          <div style={{ height: 44, border: "4px solid #9E4B54", background: "#FDF5E4", boxShadow: "6px 6px 0 rgba(0,0,0,.28)" }}>
            <div style={{ height: 9, background: "#C4818F" }} />
          </div>
          <div style={{ position: "absolute", top: 10, right: -16, width: 16, height: 20, borderTop: "4px solid #9E4B54", borderRight: "4px solid #9E4B54", borderBottom: "4px solid #9E4B54" }} />
          <div style={{ width: 80, height: 8, marginLeft: -8, marginTop: 4, background: "#C4818F", boxShadow: "4px 4px 0 rgba(0,0,0,.28)" }} />
        </div>
        <div style={{ fontFamily: dot, fontSize: 18, lineHeight: 1.2, color: "#FFEFDA", textAlign: "center" }}>{c.bootTitle}</div>
        <div className="boot-bar">
          {steps.map((done, i) => (
            <span key={i} className="boot-seg" data-done={done} />
          ))}
        </div>
        <div className="boot-caption">{caption}</div>
      </div>
    </div>
  );
}

// ── info tooltip (hover + tap) ──────────────────────────────────────────────
function Info({ open, setOpen, text }: { open: boolean; setOpen: (v: boolean) => void; text: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button onClick={() => setOpen(!open)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} aria-label="info"
        style={{ border: "none", background: "none", padding: "0 2px", cursor: "help", color: "#9A6656", display: "inline-flex", width: "auto" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
      </button>
      {open && (
        <span style={{ position: "absolute", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 30, width: 214, padding: "9px 11px", background: "#7A3F49", border: "3px solid #9E4B54", boxShadow: "4px 4px 0 rgba(0,0,0,.3)", color: "#FFEFDA", fontSize: 11, lineHeight: 1.55, textWrap: "pretty", pointerEvents: "none" }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ── share-card visibility toggle (checkbox row on the receipt) ──────────────
function ShareToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={on}
      style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "8px 11px", background: on ? "#FDE7D6" : "#FFF", boxShadow: `inset 0 0 0 2px ${on ? "#9E4B54" : "#DBB79A"}`, fontSize: 12.5, color: "#7A3F49", textAlign: "left", width: "100%" }}>
      <span style={{ flex: "none", width: 16, height: 16, display: "grid", placeItems: "center", background: on ? "#9E4B54" : "#FFF1E2", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>
        {on ? "✓" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ── inline style helpers ────────────────────────────────────────────────────
const errBlock: React.CSSProperties = { padding: "6px 9px", background: "#FBDCDF", border: "2px solid #C4646F", fontSize: 11.5, lineHeight: 1.5, color: "#8C3742" };
const ctaBtn: React.CSSProperties = { width: "100%", padding: 14, border: "4px solid #7A3F49", background: "repeating-linear-gradient(90deg,#F4A9BD 0 10px,#F0A0B5 10px 20px)", color: "#6B2F3A", fontFamily: dot, fontSize: 17, cursor: "pointer", boxShadow: "0 6px 0 #9E4B54" };
const textBtn: React.CSSProperties = { border: "none", background: "none", color: "#9E4B54", fontSize: 12.5, cursor: "pointer", padding: 6, width: "auto", boxShadow: "none" };

function segBtn(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "7px 11px", color: active ? "#7A3F49" : "#A98876", background: active ? "#FDD3E0" : "#FDF5E4", width: "auto", boxShadow: "none" };
}
function curChip(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "6px 10px", color: active ? "#7A3F49" : "#9A6656", background: active ? "#FDD3E0" : "transparent", width: "auto", boxShadow: "none" };
}
// Guest-facing tag filter chip on the counter.
function tagChip(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 9, letterSpacing: ".04em", padding: "6px 9px", color: active ? "#7A3F49" : "#8E6B5B", background: active ? "#FDD3E0" : "#FFF3E6", boxShadow: `inset 0 0 0 2px ${active ? "#9E4B54" : "#DBB79A"}`, width: "auto" };
}
// Treat thumbnail background: the real photo (cover) if set, else the dither.
function treatThumbBg(t: Treat): string {
  return t.thumbUrl ? `center / cover no-repeat url("${t.thumbUrl}")` : TREAT_DITHER;
}
function treatCard(on: boolean): React.CSSProperties {
  return { position: "relative", display: "flex", flexDirection: "column", gap: 7, width: "100%", padding: 8, border: `3px solid ${on ? "#9E4B54" : "#F0D9BE"}`, borderRadius: 16, background: on ? "#FDE7D6" : "#FFF3E6", cursor: "pointer", boxShadow: on ? "0 5px 0 #C4818F" : "0 4px 0 #EAD3B4" };
}
function pricePill(on: boolean): React.CSSProperties {
  return { position: "absolute", top: 14, right: 14, fontFamily: mono, fontSize: 10, lineHeight: 1, padding: "5px 9px", borderRadius: 999, background: on ? "#9E4B54" : "#FFF1E2", color: on ? "#FFF1E2" : "#9E4B54", boxShadow: `0 2px 0 ${on ? "#6B2F3A" : "#D9BE99"}` };
}
function methodCard(active: boolean): React.CSSProperties {
  return { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "14px 10px", cursor: "pointer", border: `3px solid ${active ? "#9E4B54" : "#DBB79A"}`, background: active ? "#FDD3E0" : "#FDF5E4", boxShadow: active ? "0 4px 0 #9E4B54" : "none", width: "auto" };
}
