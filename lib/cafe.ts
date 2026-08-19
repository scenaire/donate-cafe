// Whispering Rain Café — client data + copy for the tip page.
//
// Menu, display-currency rates, dialogue lines, and bilingual copy, transcribed
// from the design handoff (cafe-data.js + the tip-page prototype's LINES/COPY).
// The constants below (TREATS/MENU, FLOWER_LINE, IDLE_LINES, TTS_THRESHOLD_THB)
// are now fallback defaults only — app/page.tsx fetches the live values from
// /api/menu and /api/cafe-config (backed by the menu_items/cafe_settings tables
// Settings writes to) and overrides them once the fetch resolves.

import type { Lang } from "./i18n";

export type Treat = {
  id: string; // uuid once live; a fallback literal (e.g. "brownie") before the /api/menu fetch resolves
  th: string;
  en: string;
  price: number; // THB
  hidden: boolean;
  tails: { th: string; en: string }[]; // per-treat dialogue Naire says on pick
  tags: string[]; // guest-facing filter categories (lowercase)
  thumbUrl: string | null; // treat photo; null → dither placeholder
};

// Shape of a row from the public GET /api/menu.
export type MenuItemDto = {
  id: string;
  th: string;
  en: string;
  price: number; // THB
  tails: { th: string; en: string }[];
  tags: string[];
  thumbUrl: string | null;
};

// Naire's portrait expressions and the counter's time-of-day backdrop.
// "sad" triggers off Voice's manually-set weather (currentWeather === "rain").
export type Emotion = "neutral" | "smile" | "sad" | "sparkle";
export type Scene = "day" | "dusk" | "night";
export type EmotionImages = Record<Emotion, string | null>;
export type SceneImages = Record<Scene, string | null>;

// The mobile portrait sits in a small square band next to Naire's dialogue;
// the desktop one is a large rectangle in the left rail. A crop that suits one
// rarely suits the other, so each device gets its own uploaded set — same
// reasoning for the backdrop behind the mobile portrait vs. desktop's own.
export type Device = "mobile" | "desktop";
export type DeviceEmotionImages = Record<Device, EmotionImages>;
export type DeviceSceneImages = Record<Device, SceneImages>;

// Naire's voice: idle lines conditioned on time-of-day / weather / who's
// visiting, plus the two creator-editable templates for the pick-a-treat and
// thank-you moments. "Most specific match wins" — see pickIdleLine below.
export type TimeTag = "morning" | "afternoon" | "dusk" | "night";
export type WeatherTag = "rain" | "clear" | "hot";
export type GuestTag = "first" | "returning" | "top" | "away";
export type ConditionTag = TimeTag | WeatherTag | GuestTag;

export const TIME_TAGS: TimeTag[] = ["morning", "afternoon", "dusk", "night"];
export const WEATHER_TAGS: WeatherTag[] = ["rain", "clear", "hot"];
export const GUEST_TAGS: GuestTag[] = ["first", "returning", "top", "away"];

export type IdleLine = { id: string; th: string; en: string; tags: ConditionTag[] };
export type VoiceTemplate = { th: string; en: string };

// Guest's local hour → time-of-day tag. A finer split than the Café panel's
// day/dusk/night backdrop (4 buckets here vs. 3 there) since dialogue can
// afford more nuance than a background image can.
export function timeTagForHour(hour: number): TimeTag {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "dusk";
  return "night";
}

// Among lines whose tags are ALL currently active, pick the one with the
// most tags (most specific); ties broken at random. Untagged lines always
// qualify — they're the fallback when nothing more specific matches, which
// is why at least one should stay untagged (enforced at save time).
export function pickIdleLine(lines: IdleLine[], activeTags: ConditionTag[], excludeId?: string): IdleLine {
  const candidates = lines.filter((l) => l.tags.every((t) => activeTags.includes(t)));
  const pool = candidates.length > 0 ? candidates : lines;
  const maxSpec = Math.max(0, ...pool.map((l) => l.tags.length));
  let best = pool.filter((l) => l.tags.length === maxSpec);
  if (excludeId && best.length > 1) best = best.filter((l) => l.id !== excludeId);
  return best[Math.floor(Math.random() * best.length)] ?? lines[0];
}

// {{name}} {{item}} {{amount}} {{line}} substitution for the pick/thanks
// templates. Unknown/absent tokens resolve to "" rather than erroring, so a
// creator can freely reuse the same template text across both moments.
export function renderTemplate(template: string, tokens: Partial<Record<"name" | "item" | "amount" | "line", string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => tokens[key as keyof typeof tokens] ?? "");
}

// Shape of the config object from the public GET /api/cafe-config.
export type CafeConfigDto = {
  name: string;
  // Raw species text as stored/edited (e.g. "Jasmine") — Settings edits this.
  flowerOfMonth: string;
  // Display-ready "<Month> · <flowerOfMonth>", month computed server-side.
  flowerLine: string;
  idleLines: IdleLine[];
  ttsThresholdThb: number;
  // Whether the "real voice" unlock promise (the tip page's TTS meter +
  // sparkle emotion) is active at all — distinct from Google TTS on the
  // alert overlay, which reads every alert that fires regardless of this.
  realVoiceOn: boolean;
  pickTemplate: VoiceTemplate;
  thanksTemplate: VoiceTemplate;
  currentWeather: WeatherTag | null;
  emotionImages: DeviceEmotionImages;
  sceneImages: DeviceSceneImages;
  // From Privacy & moderation — whether the name box starts anonymous, and
  // whether the "Keep it private" checkbox is offered at all.
  anonDefault: boolean;
  sealedAllowed: boolean;
};

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Always English, regardless of UI language — same reasoning as fmtExpiry:
// a flower line pinned to one language reads consistently for every guest.
export function currentMonthName(d: Date = new Date()): string {
  return FULL_MONTHS[d.getUTCMonth()];
}

// From cafe-data.js. `hidden` items are kept off the public grid. These are the
// fallback treats shown before /api/menu resolves; live rows carry their own
// tags + thumbUrl, so the seed just defaults them (empty tags, no photo).
const TREAT_SEED: Omit<Treat, "tags" | "thumbUrl">[] = [
  {
    id: "brownie", th: "บราวนี่ + คุกกี้", en: "brownie & cookie", price: 20, hidden: false,
    tails: [
      { th: "เพิ่งออกจากเตาเมื่อชั่วโมงที่แล้วเอง", en: "these came out of the oven an hour ago." },
      { th: "ขอบ ๆ คือส่วนที่อร่อยที่สุด เถียงไม่ได้นะ", en: "the edges are the best part, fight me." },
    ],
  },
  {
    id: "strawmilk", th: "นมสตรอว์เบอร์รี", en: "strawberry milk", price: 50, hidden: false,
    tails: [
      { th: "ชอบสตรอว์เบอร์รีมากเลย", en: "I really like strawberry." },
      { th: "รสชาติเหมือนตอนอายุแปดขวบเลย", en: "this one tastes like being eight years old." },
    ],
  },
  {
    id: "matcha", th: "มัทฉะลาเต้", en: "matcha latte", price: 100, hidden: false,
    tails: [
      { th: "เลือกได้ดีนะ อันนี้ของโปรดเลย", en: "good choice, that one's my favourite." },
      { th: "ตีมัทฉะอย่างดี ไม่มีลัดขั้นตอน", en: "I whisk it properly, no shortcuts." },
    ],
  },
  {
    id: "choux", th: "ชูครีม", en: "choux cream", price: 150, hidden: false,
    tails: [{ th: "ครีมยังเย็นจากตู้เย็นอยู่เลย", en: "the cream's still cold from the fridge." }],
  },
  {
    id: "lavender", th: "ลาเวนเดอร์ดรีมลาเต้", en: "lavender dream latte", price: 300, hidden: true,
    tails: [{ th: "มีแค่ช่วงที่ลาเวนเดอร์ยังอยู่เท่านั้นนะ", en: "this one's only around while the lavender lasts." }],
  },
  {
    id: "basque", th: "บาสก์ราสป์เบอร์รีพิสตาชิโอ", en: "raspberry pistachio basque", price: 500, hidden: false,
    tails: [{ th: "ไหม้ด้านบนตั้งใจนะ สัญญา", en: "I burn the top on purpose, I promise." }],
  },
];

export const TREATS: Treat[] = TREAT_SEED.map((t) => ({ ...t, tags: [], thumbUrl: null }));

// The tip-page menu shows every treat (the prototype renders all six, lavender
// included; `hidden` is a dashboard/settings concern, not the public grid).
export const MENU = TREATS;

// Café goal — placeholder values matching the prototype render; wired to
// /api/summary later.
export const GOAL = { targetThb: 20000, raisedThb: 12450 };

// Flower of the month (owner-configurable later).
export const FLOWER_LINE = "July · Jasmine";

// Supporter strip seed (prototype RECENT / topName). Replaced by /api/supporters.
export type Supporter = { name: string; thb: number; when: string; th: string; en: string };
export const TOP_SUPPORTER = "ploy_";
export const RECENT: Supporter[] = [
  { name: "ploy_", thb: 200, when: "2M AGO", th: "เสียงแนร์ตอนอ่านข้อความน่ารักที่สุดเลยค่ะ พักผ่อนด้วยนะ~", en: "your voice reading messages is the cutest. rest well~" },
  { name: "kaito", thb: 300, when: "18M AGO", th: "แวะมาครั้งแรก เสียงฝนในสตรีมสงบมากเลยครับ", en: "first time here — the rain on stream is so calming." },
  { name: "minmin", thb: 500, when: "1H AGO", th: "เดือนหน้าขอ lily of the valley อีกได้ไหมคะ ชอบมาก!", en: "can we have lily of the valley again next month?" },
  { name: "nara", thb: 150, when: "3H AGO", th: "ฝากบราวนี่ให้แนร์นะคะ ♡", en: "a brownie for you, on me ♡" },
  { name: "yuki", thb: 100, when: "5H AGO", th: "มัทฉะร้านนี้อร่อยที่สุดในเมืองเลย", en: "best matcha in town, hands down." },
  { name: "คุณลูกค้าลึกลับ", thb: 500, when: "YESTERDAY", th: "ไม่ต้องอ่านออกเสียงนะคะ แค่อยากให้ร้านอยู่ต่อไปนาน ๆ", en: "no need to read it out — I just want the café to stay open." },
  { name: "tonkla", thb: 80, when: "YESTERDAY", th: "ชูครีมอร่อยมาก ขอสูตรได้ไหมครับ 555", en: "the choux was unreal. recipe please 555" },
  { name: "hoshi", thb: 1000, when: "2D AGO", th: "ยินดีด้วยกับ 5,000 ผู้ติดตามค่ะ! ไมค์ใหม่ใกล้แล้ว", en: "congrats on 5k! that new mic is close now." },
  { name: "bam.b", thb: 50, when: "2D AGO", th: "นมสตรอว์เบอร์รีสำหรับวันฝนตกค่ะ", en: "strawberry milk for a rainy day." },
  { name: "ren", thb: 250, when: "3D AGO", th: "ฟังสตรีมทำงานทุกคืนเลยครับ ขอบคุณจริง ๆ", en: "I work to your streams every night. thank you, really." },
  { name: "mook", thb: 20, when: "4D AGO", th: "คุกกี้หนึ่งชิ้นนะคะ เจอกันรอบหน้า!", en: "one cookie~ see you next stream!" },
  { name: "jinny", thb: 300, when: "5D AGO", th: "ลาเวนเดอร์ลาเต้เป็นเมนูโปรดเลยค่ะ", en: "lavender latte is my whole personality now." },
];

// TTS "real voice" threshold, in THB.
export const TTS_THRESHOLD_THB = 500;

// Display-only currencies. Prices are authored in THB; the charge is ALWAYS THB.
// These fixed rates only convert for display (SRS decision #4).
// The prototype's currency toggle has exactly three currencies (no EUR).
export type DisplayCurrency = "THB" | "USD" | "JPY";
export const CURRENCIES: { code: DisplayCurrency; symbol: string; rate: number }[] = [
  { code: "THB", symbol: "฿", rate: 1 },
  { code: "USD", symbol: "$", rate: 0.028 },
  { code: "JPY", symbol: "¥", rate: 4.4 },
];
export const CUR_BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c])) as Record<
  DisplayCurrency,
  { code: DisplayCurrency; symbol: string; rate: number }
>;

// THB → display units, with the handoff's rounding rules:
//  rate >= 1 (JPY): nearest 10, floor 10.
//  rate  < 1 (USD/EUR): > 20 → whole unit; else one decimal, floor 0.5.
export function toDisplay(thb: number, cur: DisplayCurrency): number {
  const { rate } = CUR_BY_CODE[cur];
  if (cur === "THB") return Math.round(thb);
  const v = thb * rate;
  if (rate >= 1) return Math.max(10, Math.round(v / 10) * 10);
  if (v > 20) return Math.round(v);
  return Math.max(0.5, Math.round(v * 10) / 10);
}

// Display units the payer typed → THB (for a custom amount).
export function displayToThb(displayValue: number, cur: DisplayCurrency): number {
  const { rate } = CUR_BY_CODE[cur];
  if (!Number.isFinite(displayValue)) return 0;
  return displayValue / rate;
}

export function fmtDisplay(thb: number, cur: DisplayCurrency): string {
  const v = toDisplay(thb, cur);
  const s = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(1);
  return CUR_BY_CODE[cur].symbol + s;
}

export function baht(n: number): string {
  return "฿" + Math.round(n).toLocaleString("en-US");
}

// Receipt timestamp: "YYYY-MM-DD HH:MM".
export function fmtStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// PromptPay QR ticket expiry: "14 Aug 2026, 14:32". Always Gregorian /
// English month abbreviation, independent of the page's display language —
// the QR ticket itself is pinned to English so a saved/screenshotted copy
// reads the same for every payer.
const EXPIRY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtExpiry(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${EXPIRY_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Goal deadline, "YYYY-MM-DD" → "Aug 31" — same English-pinned reasoning as
// fmtExpiry (the goal bar's "until …" line reads the same for every guest).
export function fmtGoalDeadline(isoDate: string): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  return `${EXPIRY_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Relative "time ago" tag for supporter rows, in the prototype's uppercase style
// ("2M AGO" / "1H AGO" / "YESTERDAY" / "3D AGO").
export function relTime(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "NOW";
  if (mins < 60) return mins + "M AGO";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "H AGO";
  const days = Math.floor(hrs / 24);
  if (days === 1) return "YESTERDAY";
  return days + "D AGO";
}

// A recent supporter as returned by /api/supporters.
export type RecentSupporter = {
  name: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  note: string;
};

// Idle dialogue lines cycled by the ▼ advance button (tip-page LINES). Kept
// untagged — a fallback default set, not an attempt to seed real conditions.
export const IDLE_LINES: IdleLine[] = [
  {
    id: "seed-1",
    th: "ยินดีต้อนรับสู่ Whispering Rain Café ค่ะ~ วันนี้ฝนตกเบา ๆ พอดีเลย นั่งตรงไหนก็ได้นะคะ ♡",
    en: "Welcome to Whispering Rain Café~ It's drizzling today, just right. Sit anywhere you like ♡",
    tags: [],
  },
  {
    id: "seed-2",
    th: "แนร์เป็นแอนดรอยด์ที่ถูกสร้างมาเพื่อเป็นเพื่อนกับคนค่ะ แต่ตอนนี้แนร์ชอบชงเครื่องดื่มมากกว่า เอ๊ะ ความลับนะ",
    en: "I'm an android made to be a friend to people… though lately I like brewing drinks more. Shh, that's a secret.",
    tags: [],
  },
  {
    id: "seed-3",
    th: "บางวันฝนตกทั้งวัน ร้านก็เงียบเหงาซะ… แต่พอมีคนแวะมา แนร์ก็ดีใจขึ้นมาเลยนะคะ",
    en: "Some days it rains all day and the café feels a little lonely… but the moment someone drops by, I cheer right up.",
    tags: [],
  },
  {
    id: "seed-4",
    th: "เดือนนี้ร้านตกแต่งด้วยดอกไม้ประจำเดือน เปลี่ยนทุกเดือนเลยนะคะ เดือนหน้าจะเป็นดอกอะไรดี~",
    en: "Every month the café is decorated with a different flower. What should next month's be~?",
    tags: [],
  },
];

// Defaults for the pick/thanks templates — extend the wording the tip page
// already used to render these moments before they were editable.
export const PICK_TEMPLATE_DEFAULT: VoiceTemplate = {
  th: "รับ{{item}} {{amount}} นะคะ~ ขอบคุณค่ะ ♡ {{line}}",
  en: "One {{item}}, {{amount}} — coming right up ♡ {{line}}",
};
export const THANKS_TEMPLATE_DEFAULT: VoiceTemplate = {
  th: "ขอบคุณ{{name}}มากเลยค่ะ ♡ {{item}}ชิ้นนี้จะอยู่บนชั้นของแนร์ตลอดนะคะ",
  en: "Thank you so much, {{name}} ♡ This {{item}} has a spot on my shelf forever.",
};

// Café copy (tip-page COPY), trimmed to the keys the phase-1 page renders.
export type CafeCopy = {
  tagline: string;
  flowerLabel: string;
  menuTitle: string;
  tagAll: string; // "everything" chip on the guest tag filter
  amountLabel: string;
  eachLabel: string;
  qtyLabel: string;
  customPlaceholder: string;
  nameLabel: string;
  anonName: string;
  anonLabel: string;
  anonTip: string;
  noteLabel: string;
  notePlaceholder: string;
  privLabel: string;
  privTip: string;
  goalLabel: string;
  goalItem: string;
  goalUntil: (date: string) => string;
  slipLabel: string;
  topLabel: string;
  topSince: (month: string) => string;
  recentLabel: string;
  seeAll: string;
  guestBook: string;
  guestBookCount: (n: number) => string;
  guestBookFoot: string;
  closeLabel: string;
  ttsLabel: string; // mobile: heading above the TTS meter
  ttsUnlocked: string;
  ttsToGo: (n: string) => string;
  raisedWord: string;
  goalWord: string;
  cta: (t: string) => string;
  ctaShort: string; // mobile: compact CTA beside the sticky total
  totalLabel: string; // mobile: label above the sticky total
  ctaEmpty: string;
  minWarn: (n: string) => string;
  payTitle: string;
  payAmount: string;
  methodLabel: string;
  ppName: string;
  ppSub: string;
  ppThbOnly: string; // shown on the PromptPay method card when the display currency isn't THB
  cdName: string;
  emailLabel: string;
  mailTip: string;
  qrTitle: string;
  qrBody: string;
  qrNote: string;
  qrTimer: (mmss: string) => string;
  qrExpired: string;
  tryAgainBtn: string;
  qrLockTitle: string;
  qrLockBody: string;
  qrSent: (e: string) => string;
  saveQrBtn: string;
  qrSavedBtn: string;
  qrPayTo: (name: string) => string;
  qrTotalLabel: string;
  qrExpiryLabel: string;
  payCta: (t: string) => string;
  backEdit: string;
  secureNote: string;
  errEmail: string;
  errCard: string;
  thbNote: (t: string) => string;
  payLine: string;
  pickNote: (label: string, t: string) => string;
  receiptTitle: string;
  orderNoLabel: string;
  guestLabel: string;
  noteLabelR: string;
  noteOnStream: string;
  notePrivate: string;
  goalAfter: string;
  receiptFoot: string;
  saveImg: string;
  backCafe: string;
  mailed: (e: string) => string;
  thanksReceipt: (who: string, voice: string) => string;
  voiceNote: string;
  paidTitle: string;
  paidSub: (e: string) => string;
  paidHelp: string;
  shareTitle: string;
  shareHint: string;
  shareKicker: string;
  shareCta: string;
  shareSave: string;
  shareCopy: string;
  shareCopied: string;
  shareTogAmount: string;
  shareTogNote: string;
  shareTogGoal: string;
};

// Café handle shown on the share story (prototype shareHandle).
export const SHARE_HANDLE = "NAIRELIE.CAFE";

export const CAFE_COPY: Record<Lang, CafeCopy> = {
  th: {
    tagline: "คาเฟ่เล็ก ๆ ของแนร์ · ฝากขนมให้กันได้นะคะ",
    flowerLabel: "ดอกไม้เดือนนี้",
    menuTitle: "เลือกเมนู~",
    tagAll: "ทั้งหมด",
    amountLabel: "จำนวนเงิน · ตั้งเองก็ได้",
    eachLabel: "ต่อชิ้น",
    qtyLabel: "จำนวน",
    customPlaceholder: "ตั้งราคาเอง",
    nameLabel: "ชื่อของคุณ",
    anonName: "คุณลูกค้าลึกลับ",
    anonLabel: "ไม่ระบุตัวตน",
    anonTip: "ชื่อของคุณจะไม่ขึ้นบนหน้าร้านและบนสตรีม และแนร์ก็ไม่เห็นชื่อคุณเช่นกันนะคะ",
    noteLabel: "ฝากข้อความ",
    notePlaceholder: "มีอะไรฝากถึงแนร์มั้ยคะ~",
    privLabel: "เก็บเป็นความลับ",
    privTip: "ข้อความจะไม่ขึ้นบนสตรีมและไม่ถูกอ่านออกเสียง แนร์อ่านเองคนเดียวค่ะ",
    goalLabel: "เป้าหมายของร้าน",
    goalItem: "ไมค์ตัวใหม่ ♡",
    goalUntil: (date) => `ถึง ${date}`,
    slipLabel: "รายการออเดอร์",
    topLabel: "แขกคนโปรดประจำเดือนนี้",
    topSince: (m) => "ผู้นำใจดีประจำเดือน" + m + " ♡",
    recentLabel: "แวะมาเมื่อเร็ว ๆ นี้",
    seeAll: "ดูทั้งหมด",
    guestBook: "สมุดผู้มาเยือน",
    guestBookCount: (n) => n + " คนแวะมา",
    guestBookFoot: "แนร์อ่านทุกข้อความเลยนะคะ ♡",
    closeLabel: "ปิด",
    ttsLabel: "เสียงจริงของแนร์",
    ttsUnlocked: "เสียงแนร์อ่านให้เลย ♡",
    ttsToGo: (n) => "อีก " + n + " แนร์จะอ่านด้วยเสียงตัวเอง",
    raisedWord: "ได้แล้ว",
    goalWord: "เป้าหมาย",
    cta: (t) => "ไปชำระเงิน " + t,
    ctaShort: "ชำระเงิน",
    totalLabel: "รวม",
    ctaEmpty: "ใส่จำนวนเงินก่อนนะคะ",
    minWarn: (n) => "ขั้นต่ำ " + n + " นะคะ~ ใส่จำนวนเงินก่อนนะ",
    payTitle: "ชำระเงิน",
    payAmount: "ยอดที่จะชำระ",
    methodLabel: "วิธีชำระเงิน",
    ppName: "พร้อมเพย์",
    ppSub: "สแกน QR",
    ppThbOnly: "ใช้ได้เฉพาะสกุลเงินบาทเท่านั้น",
    cdName: "บัตรเครดิต/เดบิต",
    emailLabel: "อีเมล (สำหรับใบเสร็จ)",
    mailTip: "ใช้ส่งใบเสร็จให้คุณเท่านั้นค่ะ ไม่มีอีเมลโปรโมชั่นแน่นอน",
    qrTitle: "สแกนด้วยแอปธนาคาร",
    qrBody: "เปิดแอปธนาคารของคุณ แล้วสแกน QR นี้ ตรวจสอบยอดเงินให้ถูกต้องก่อนยืนยันนะคะ",
    qrNote: "QR ใช้ได้ 10 นาที",
    qrTimer: (mmss) => "QR หมดอายุใน " + mmss,
    qrExpired: "QR หมดอายุแล้ว กรุณาลองใหม่อีกครั้ง",
    tryAgainBtn: "ลองใหม่",
    qrLockTitle: "ใส่อีเมลก่อนนะคะ",
    qrLockBody: "กรอกอีเมลด้านบนก่อน แล้ว QR พร้อมเพย์จะปรากฏตรงนี้ค่ะ~ ใบเสร็จจะส่งเข้าอีเมลทันทีที่จ่ายเสร็จ",
    qrSent: (e) => "ใบเสร็จจะส่งไปที่ " + e,
    saveQrBtn: "บันทึก QR ลงเครื่อง",
    qrSavedBtn: "บันทึกแล้ว ✓",
    qrPayTo: (name) => "ส่งความรักให้ " + name,
    qrTotalLabel: "ยอดชำระ",
    qrExpiryLabel: "QR หมดอายุ",
    payCta: (t) => "จ่าย " + t,
    backEdit: "← กลับไปแก้ไขใบสั่ง",
    secureNote: "ชำระเงินผ่านช่องทางที่เข้ารหัส",
    errEmail: "ใส่อีเมลที่ใช้ได้ก่อนนะคะ จะส่งใบเสร็จไปให้",
    errCard: "ข้อมูลบัตรยังไม่ครบนะคะ~",
    thbNote: (t) => "เรียกเก็บเป็นเงินบาท ประมาณ " + t,
    payLine: "รับใบสั่งแล้วค่ะ~ เลือกวิธีจ่ายได้เลยนะคะ แนร์รออยู่ตรงนี้ ♡",
    pickNote: (label, t) => "รับ" + label + " " + t + " นะคะ~ ขอบคุณค่ะ ♡",
    receiptTitle: "ใบเสร็จ",
    orderNoLabel: "เลขที่",
    guestLabel: "ลูกค้า",
    noteLabelR: "ข้อความที่ฝากไว้",
    noteOnStream: "จะขึ้นบนสตรีม",
    notePrivate: "เฉพาะแนร์เท่านั้น",
    goalAfter: "เป้าหมายหลังจากนี้",
    receiptFoot: "ขอบคุณที่แวะมานะคะ ♡",
    saveImg: "บันทึกใบเสร็จเป็นรูป",
    backCafe: "← กลับไปที่ร้าน",
    mailed: (e) => "ส่งใบเสร็จไปที่ " + e + " แล้วค่ะ",
    thanksReceipt: (who, voice) => "ขอบคุณ" + who + "มากเลยค่ะ ♡ ขนมชิ้นนี้จะอยู่บนชั้นของแนร์ตลอดนะคะ" + voice,
    voiceNote: " ข้อความนี้แนร์จะอ่านด้วยเสียงตัวเองเลยค่ะ!",
    paidTitle: "รับเงินแล้วเรียบร้อย ♡",
    paidSub: (e) => "ใบเสร็จส่งไปที่ " + e + " แล้วนะคะ",
    paidHelp: "มีปัญหากับรายการนี้?",
    shareTitle: "แชร์ขนมของคุณ",
    shareHint: "ลากรูปร้านมาวางบนการ์ดเพื่อทำพื้นหลัง",
    shareKicker: "เลี้ยงแนร์แล้ว",
    shareCta: "แวะไปเลี้ยงแนร์ได้เลย",
    shareSave: "บันทึกลงสตอรี่",
    shareCopy: "คัดลอกลิงก์ร้าน",
    shareCopied: "คัดลอกลิงก์ร้านแล้ว ♡",
    shareTogAmount: "แสดงยอด",
    shareTogNote: "ใส่ข้อความของฉัน",
    shareTogGoal: "แสดงเป้าหมายร้าน",
  },
  en: {
    tagline: "Naire's little café · leave a treat if you like",
    flowerLabel: "FLOWER OF THE MONTH",
    menuTitle: "Pick a treat~",
    tagAll: "everything",
    amountLabel: "AMOUNT · OR NAME YOUR OWN",
    eachLabel: "EACH",
    qtyLabel: "QUANTITY",
    customPlaceholder: "name your price",
    nameLabel: "YOUR NAME",
    anonName: "Anonymous",
    anonLabel: "Stay anonymous",
    anonTip: "Your name won't appear on the café wall, on stream, or to Naire — anonymous everywhere.",
    noteLabel: "LEAVE A NOTE",
    notePlaceholder: "anything you'd like to tell me~",
    privLabel: "Keep it private",
    privTip: "Your note won't be shown on stream or read aloud. Naire reads it on her own.",
    goalLabel: "CAFÉ GOAL",
    goalItem: "a new microphone ♡",
    goalUntil: (date) => `until ${date}`,
    slipLabel: "YOUR ORDER SLIP",
    topLabel: "TOP SUPPORTER THIS MONTH",
    topSince: (m) => "leading the café through " + m + " ♡",
    recentLabel: "RECENTLY STOPPED BY",
    seeAll: "see all",
    guestBook: "Guest book",
    guestBookCount: (n) => n + " guests",
    guestBookFoot: "Naire reads every single one ♡",
    closeLabel: "Close",
    ttsLabel: "NAIRE'S REAL VOICE",
    ttsUnlocked: "read in my own voice ♡",
    ttsToGo: (n) => n + " more for my real voice",
    raisedWord: "raised",
    goalWord: "goal",
    cta: (t) => "Go to checkout " + t,
    ctaShort: "Checkout",
    totalLabel: "TOTAL",
    ctaEmpty: "enter an amount first~",
    minWarn: (n) => "Minimum is " + n + "~ pop an amount in first.",
    payTitle: "CHECKOUT",
    payAmount: "AMOUNT DUE",
    methodLabel: "PAYMENT METHOD",
    ppName: "PromptPay",
    ppSub: "scan a QR",
    ppThbOnly: "THB only",
    cdName: "Credit / debit card",
    emailLabel: "EMAIL (FOR YOUR RECEIPT)",
    mailTip: "Only used to send your receipt. No marketing mail, promise.",
    qrTitle: "Scan with your bank app",
    qrBody: "Open your banking app and scan this code. Check the amount before you confirm.",
    qrNote: "QR VALID FOR 10 MINUTES",
    qrTimer: (mmss) => "QR expires in " + mmss,
    qrExpired: "QR expired — please try again",
    tryAgainBtn: "Try again",
    qrLockTitle: "Add your email first",
    qrLockBody: "Pop your email in above and the PromptPay QR appears right here — your receipt lands in your inbox the moment you pay.",
    qrSent: (e) => "Receipt will be sent to " + e,
    saveQrBtn: "Save QR code",
    qrSavedBtn: "Saved ✓",
    qrPayTo: (name) => "Sending Love to " + name,
    qrTotalLabel: "TOTAL",
    qrExpiryLabel: "QR EXPIRES",
    payCta: (t) => "Pay " + t,
    backEdit: "← back to my order",
    secureNote: "Encrypted checkout",
    errEmail: "Pop in a working email — that's where the receipt goes.",
    errCard: "Card details aren't complete yet~",
    thbNote: (t) => "charged in THB, about " + t,
    payLine: "Order taken~ pick however you'd like to pay. I'll wait right here ♡",
    pickNote: (label, t) => "One " + label + ", " + t + " — coming right up ♡",
    receiptTitle: "RECEIPT",
    orderNoLabel: "ORDER",
    guestLabel: "GUEST",
    noteLabelR: "YOUR NOTE",
    noteOnStream: "SHOWN ON STREAM",
    notePrivate: "FOR NAIRE ONLY",
    goalAfter: "GOAL AFTER YOUR TIP",
    receiptFoot: "THANK YOU FOR STOPPING BY ♡",
    saveImg: "Save receipt as image",
    backCafe: "← back to the café",
    mailed: (e) => "Receipt sent to " + e,
    thanksReceipt: (who, voice) => "Thank you so much, " + who + " ♡ This treat has a spot on my shelf forever." + voice,
    voiceNote: " I'll read this one in my own voice!",
    paidTitle: "Payment received ♡",
    paidSub: (e) => "Receipt is on its way to " + e,
    paidHelp: "Something wrong with this order?",
    shareTitle: "Share your treat",
    shareHint: "drop a café photo on the card for the backdrop",
    shareKicker: "I BOUGHT NAIRE",
    shareCta: "TAP TO BUY HER ONE",
    shareSave: "Save for Stories",
    shareCopy: "Copy café link",
    shareCopied: "Café link copied ♡",
    shareTogAmount: "Show amount",
    shareTogNote: "Include my message",
    shareTogGoal: "Show café goal",
  },
};

// ── Alerts overlay ───────────────────────────────────────────────────────────
// SIMPLE mode keeps the built-in /alert design (flower/pill/petals/chime),
// retuned by the sliders/switches below. CODE mode replaces the visual layer
// only — the queue, realtime delivery, chime and TTS are identical either way.

export type AlertMode = "simple" | "code";
export type AlertPreset = "polaroid" | "receipt" | "bubble";

export type AlertConfig = {
  mode: AlertMode;
  preset: AlertPreset | null;
  html: string;
  css: string;
  js: string;
  durationSec: number; // how long one alert holds on screen
  minAmountThb: number; // THB tips below this don't alert (0 = every tip)
  spawnGapSec: number; // pause between one alert closing and the next opening
  soundOn: boolean;
  ttsOn: boolean;
  soundVolume: number; // 0-100, applies to both the chime and the Google TTS read-aloud
};

export const ALERT_DURATION_RANGE = { min: 3, max: 15, step: 1 } as const;
export const ALERT_MIN_AMOUNT_RANGE = { min: 0, max: 200, step: 5 } as const;
export const ALERT_SPAWN_GAP_RANGE = { min: 3, max: 10, step: 1 } as const;
export const ALERT_TTS_THRESHOLD_RANGE = { min: 50, max: 500, step: 10 } as const;
export const ALERT_VOLUME_RANGE = { min: 0, max: 100, step: 5 } as const;

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  mode: "simple",
  preset: null,
  html: "",
  css: "",
  js: "",
  durationSec: 7,
  minAmountThb: 0,
  spawnGapSec: 3,
  soundOn: true,
  ttsOn: true,
  soundVolume: 100,
};

// Starter CODE-mode templates, transcribed verbatim from the design handoff
// (Creator Settings.dc.html's ALERT_PRESET_CODE). `data` in the JS is
// { name, item, amount, message, photo, pctNum }.
export const ALERT_PRESETS: Record<AlertPreset, { html: string; css: string; js: string }> = {
  polaroid: {
    html: [
      '<div class="card">',
      '  <div class="pola">',
      '    <img src="{{photo}}" alt="">',
      '    <span class="cap">{{item}}</span>',
      "  </div>",
      '  <div class="body">',
      '    <b class="who">{{name}} bought Naire</b>',
      '    <span class="amt">{{item}} · {{amount}}</span>',
      '    <span class="note">{{message}}</span>',
      "  </div>",
      "</div>",
    ].join("\n"),
    css: [
      ".card{position:absolute;left:20px;top:20px;display:flex;align-items:flex-start;gap:14px;font-family:system-ui,'Segoe UI',sans-serif}",
      ".pola{background:#FFF;border:4px solid #7A3F49;padding:7px 7px 0;transform:rotate(-3deg);box-shadow:5px 6px 0 rgba(107,47,58,.3)}",
      ".pola img{display:block;width:120px;height:120px;object-fit:cover;background:repeating-linear-gradient(45deg,#EEDCBE 0 8px,#E7D2B0 8px 16px)}",
      ".pola .cap{display:block;text-align:center;font-size:12px;color:#9E4B54;padding:6px 2px 8px;font-weight:700}",
      ".body{background:#FFFBF2;border:4px solid #9E4B54;padding:13px 16px;display:flex;flex-direction:column;gap:6px;max-width:420px;box-shadow:5px 6px 0 rgba(107,47,58,.3)}",
      ".who{color:#9E4B54;font-size:13px;letter-spacing:.05em;text-transform:uppercase}",
      ".amt{color:#7A3F49;font-size:23px;font-weight:800}",
      ".note{color:#6B4535;font-size:14px;line-height:1.5}",
    ].join("\n"),
    js: "// el = root, data = { name, item, amount, message, photo, pctNum }\n// hide the note line when there isn't one:\nif (!data.message) { var n = el.querySelector('.note'); if (n) n.style.display='none'; }",
  },
  receipt: {
    html: [
      '<div class="slip">',
      '  <div class="top">✧ WHISPERING RAIN CAFÉ ✧</div>',
      '  <img class="ph" src="{{photo}}" alt="">',
      '  <div class="row"><span>{{name}}</span><span>{{amount}}</span></div>',
      '  <div class="item">{{item}}</div>',
      '  <div class="note">“{{message}}”</div>',
      "</div>",
    ].join("\n"),
    css: [
      ".slip{position:absolute;left:20px;top:20px;width:340px;background:#FFFBF2;border:3px dashed #9E4B54;padding:16px;font-family:'Courier New',monospace;color:#6B2F3A;box-shadow:5px 6px 0 rgba(107,47,58,.28)}",
      ".top{text-align:center;font-weight:800;letter-spacing:.08em;color:#9E4B54;font-size:13px;margin-bottom:10px}",
      ".ph{display:block;width:100%;height:120px;object-fit:cover;margin-bottom:10px;background:repeating-linear-gradient(45deg,#EEDCBE 0 8px,#E7D2B0 8px 16px)}",
      ".row{display:flex;justify-content:space-between;font-size:16px;font-weight:800;border-bottom:2px dotted #C4818F;padding-bottom:6px}",
      ".item{font-size:14px;margin-top:6px}",
      ".note{margin-top:8px;font-size:13px;font-style:italic;line-height:1.5}",
    ].join("\n"),
    js: "// el = root, data = { name, item, amount, message, photo, pctNum }",
  },
  bubble: {
    html: [
      '<div class="wrap">',
      '  <div class="ava"><img src="{{photo}}" alt=""></div>',
      '  <div class="talk">',
      "    <b>{{name}}</b> tipped <b>{{amount}}</b>",
      "    <span>{{item}}</span>",
      "    <em>{{message}}</em>",
      "  </div>",
      "</div>",
    ].join("\n"),
    css: [
      ".wrap{position:absolute;left:20px;top:20px;display:flex;align-items:center;gap:14px;font-family:system-ui,'Segoe UI',sans-serif}",
      ".ava{width:92px;height:92px;border-radius:50%;overflow:hidden;border:5px solid #F4A9BD;box-shadow:0 5px 0 rgba(107,47,58,.3)}",
      ".ava img{width:100%;height:100%;object-fit:cover;background:repeating-linear-gradient(45deg,#EEDCBE 0 8px,#E7D2B0 8px 16px)}",
      ".talk{position:relative;background:#FFFBF2;border:4px solid #9E4B54;border-radius:18px;padding:13px 18px;display:flex;flex-direction:column;gap:4px;max-width:420px;color:#7A3F49;font-size:16px;box-shadow:0 5px 0 rgba(107,47,58,.3)}",
      ".talk b{color:#9E4B54}",
      ".talk span{font-size:14px;color:#6B4535}",
      ".talk em{font-size:14px;color:#6B4535}",
    ].join("\n"),
    js: "// el = root, data = { name, item, amount, message, photo, pctNum }\n// pop in each time it fires:\nel.animate([{transform:'scale(.9)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:260,easing:'steps(6)'});",
  },
};

export type AlertTokens = {
  name: string;
  item: string;
  amount: string;
  message: string;
  photo: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Unlike Voice's renderTemplate (plain dialogue text), this substitutes into
// literal HTML markup — every value gets HTML-escaped so a donor's name or
// message can never break out of the template and inject markup, regardless
// of how the streamer wrote their CODE-mode HTML. Shared by both Alerts'
// CODE mode and the Goal bar overlay's CODE mode.
export function renderHtmlTemplate<T extends Record<string, string>>(template: string, tokens: T): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = tokens[key as keyof T];
    return v !== undefined ? escapeHtml(v) : "";
  });
}

// Kept as a thin alias — every existing call site names it this way.
export const renderAlertTemplate: (template: string, tokens: AlertTokens) => string = renderHtmlTemplate;

// ── Goal bar overlay ─────────────────────────────────────────────────────────
// SIMPLE mode is a styled bar (fill/texture/backing/height/labels/align, all
// pickable in Settings). CODE mode replaces the visual layer only, same
// split as the Alerts overlay — updates arrive the same way either way
// (realtime broadcast on a successful tip, same shared widget token).

export type JarMode = "simple" | "code";
export type JarPreset = "boba" | "shelf" | "minimal";
export type JarFill = "pink" | "matcha" | "lavender" | "amber";
export type JarTexture = "stripe" | "solid";
export type JarBacking = "cream" | "dark" | "outline";
export type JarAlign = "left" | "center" | "right";

export type JarConfig = {
  mode: JarMode;
  preset: JarPreset | null;
  html: string;
  css: string;
  js: string;
  fill: JarFill;
  texture: JarTexture;
  backing: JarBacking;
  heightPx: number;
  showName: boolean;
  showPct: boolean;
  showAmount: boolean;
  align: JarAlign;
};

export const JAR_HEIGHT_RANGE = { min: 12, max: 44, step: 2 } as const;

export const DEFAULT_JAR_CONFIG: JarConfig = {
  mode: "simple",
  preset: null,
  html: "",
  css: "",
  js: "",
  fill: "pink",
  texture: "stripe",
  backing: "cream",
  heightPx: 20,
  showName: true,
  showPct: false,
  showAmount: true,
  align: "left",
};

const JAR_FILL_COLORS: Record<JarFill, [string, string]> = {
  pink: ["#F4A9BD", "#EE93AB"],
  matcha: ["#9CC17C", "#7DAA5A"],
  lavender: ["#C9A2D6", "#B98FC8"],
  amber: ["#F2C97D", "#E7AE75"],
};

// Shared by the Settings preview and the live overlay so the two can never
// drift — "what you see in Settings" has to be the literal CSS the OBS
// source renders, not a close approximation of it.
export function jarFillCss(fill: JarFill, texture: JarTexture): string {
  const [light, dark] = JAR_FILL_COLORS[fill];
  return texture === "stripe" ? `repeating-linear-gradient(90deg,${light} 0 5px,${dark} 5px 10px)` : dark;
}

export function jarBackingCss(backing: JarBacking): { background: string; boxShadow: string } {
  if (backing === "dark") return { background: "rgba(30,16,20,.55)", boxShadow: "inset 0 0 0 3px rgba(255,255,255,.25)" };
  if (backing === "outline") return { background: "transparent", boxShadow: "inset 0 0 0 3px #FFF1E2" };
  return { background: "#E7D2B0", boxShadow: "inset 0 0 0 3px #DBB79A" }; // cream — the café's own existing look
}

// Starter CODE-mode templates, transcribed verbatim from the design handoff
// (Creator Settings.dc.html's JAR_PRESET_CODE). `data` in the JS is
// { goalName, raised, target, goalPct, pctNum }.
export const JAR_PRESETS: Record<JarPreset, { html: string; css: string; js: string }> = {
  boba: {
    html: [
      '<div class="goal">',
      '  <div class="cup">',
      '    <div class="fill" style="height:{{goalPct}}"></div>',
      '    <div class="lid"></div>',
      '    <div class="straw"></div>',
      "  </div>",
      '  <div class="tag">',
      "    <b>{{goalName}}</b>",
      "    <span>{{raised}} / {{target}}</span>",
      "  </div>",
      "</div>",
    ].join("\n"),
    css: [
      ".goal{position:absolute;left:20px;bottom:16px;display:flex;align-items:flex-end;gap:13px;font-family:system-ui,'Segoe UI',sans-serif}",
      ".cup{position:relative;width:64px;height:96px;border:4px solid #7A3F49;border-radius:8px 8px 16px 16px;background:rgba(255,255,255,.55);overflow:hidden}",
      ".fill{position:absolute;left:0;right:0;bottom:0;background:repeating-linear-gradient(0deg,#EE93AB 0 9px,#F4A9BD 9px 18px);transition:height .5s}",
      ".lid{position:absolute;left:-5px;right:-5px;top:-3px;height:12px;background:#F4A9BD;border:4px solid #7A3F49;border-radius:7px}",
      ".straw{position:absolute;right:14px;top:-18px;width:9px;height:44px;background:#E86A86;border:3px solid #7A3F49;border-radius:4px;transform:rotate(12deg)}",
      ".tag{background:#FFF1E2;border:3px solid #9E4B54;border-radius:12px;padding:8px 13px;display:flex;flex-direction:column;gap:3px}",
      ".tag b{color:#7A3F49;font-size:15px}",
      ".tag span{color:#9E4B54;font-weight:800;font-size:14px}",
    ].join("\n"),
    js: "// runs once after the bar mounts, then on every update\n// el = your root, data = { goalName, raised, target, goalPct, pctNum }\n// e.g. pop the cup when the goal is hit:\nif (data.pctNum >= 100) el.querySelector('.cup').style.transform = 'scale(1.06)';",
  },
  shelf: {
    html: [
      '<div class="shelf">',
      '  <div class="bar">',
      '    <div class="fill" style="width:{{goalPct}}"></div>',
      '    <div class="label">{{goalName}}<em>{{raised}} / {{target}}</em></div>',
      "  </div>",
      '  <div class="leg" style="left:34px"></div>',
      '  <div class="leg" style="right:34px"></div>',
      "</div>",
    ].join("\n"),
    css: [
      ".shelf{position:absolute;left:16px;right:16px;bottom:20px;font-family:system-ui,'Segoe UI',sans-serif}",
      ".bar{position:relative;height:46px;background:#7A4A32;border:5px solid #4E2E1E;border-radius:12px;overflow:hidden;box-shadow:0 7px 0 rgba(0,0,0,.18)}",
      ".fill{position:absolute;inset:0;width:0;background:repeating-linear-gradient(90deg,#BE8154 0 14px,#A96C41 14px 28px);transition:width .5s}",
      ".label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:14px;color:#FFF6EA;font-weight:800;letter-spacing:.08em;font-size:15px;text-shadow:1px 1px 0 rgba(0,0,0,.4)}",
      ".label em{font-style:normal;font-weight:700;font-size:14px;opacity:.95}",
      ".leg{position:absolute;bottom:-13px;width:16px;height:14px;background:#4E2E1E;border-radius:0 0 5px 5px}",
    ].join("\n"),
    js: "// el = root, data = { goalName, raised, target, goalPct, pctNum }\nif (data.pctNum >= 100) el.querySelector('.label').textContent = 'GOAL MET ✨';",
  },
  minimal: {
    html: [
      '<div class="wrap">',
      '  <div class="head"><span>{{goalName}}</span><span>{{goalPct}}</span></div>',
      '  <div class="track"><div class="fill" style="width:{{goalPct}}"></div></div>',
      '  <div class="sub">{{raised}} of {{target}}</div>',
      "</div>",
    ].join("\n"),
    css: [
      ".wrap{position:absolute;left:22px;right:22px;bottom:20px;font-family:system-ui,'Segoe UI',sans-serif}",
      ".head{display:flex;justify-content:space-between;color:#7A3F49;font-weight:800;font-size:15px;margin-bottom:7px;text-transform:uppercase;letter-spacing:.06em}",
      ".track{height:16px;background:#EAD9C4;border-radius:10px;overflow:hidden}",
      ".fill{height:100%;width:0;background:linear-gradient(90deg,#F4A9BD,#EE93AB);transition:width .5s}",
      ".sub{margin-top:6px;color:#9E4B54;font-weight:700;font-size:12px}",
    ].join("\n"),
    js: "// el = root, data = { goalName, raised, target, goalPct, pctNum }\n// leave empty for none",
  },
};

export type JarTokens = {
  goalName: string;
  raised: string;
  target: string;
  goalPct: string; // pre-formatted with a trailing "%", ready to drop into a CSS width/height
};
