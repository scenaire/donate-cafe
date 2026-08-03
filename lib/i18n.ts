export type Lang = "th" | "en";

export function isLang(x: unknown): x is Lang {
  return x === "th" || x === "en";
}

// Admin-facing strings, kept separate from the payer-facing set below so the
// public page doesn't carry dashboard copy it never renders.
export const dashboardTranslations: Record<
  Lang,
  {
    title: string;
    subtitle: string;
    loading: string;
    unauthorized: string;
    signInLink: string;
    loadError: string;
    empty: string;
    colTime: string;
    colName: string;
    colAmount: string;
    colMessage: string;
    colShowOnScreen: string;
    colStatus: string;
    noMessage: string;
    loadMore: string;
    loadingMore: string;
    searchPlaceholder: string;
    filterAll: string;
    signOut: string;
    overrideBtn: string;
    overrideConfirm: string;
    overrideDone: string;
    overrideFailed: string;
    // Replay has no confirm string: unlike an override it changes no data, so
    // the cost of a misclick is one alert you did not want, not a wrong record.
    replayBtn: string;
    replaySent: string;
    replayFailed: string;
    goalLabel: string;
    goalNone: string;
    totalsLabel: string;
    statusLabels: Record<"PENDING" | "SUCCESS" | "EXPIRED" | "FAILED", string>;
    loginTitle: string;
    loginSubtitle: string;
    loginEmail: string;
    loginPassword: string;
    loginBtn: string;
    loginBusy: string;
    loginFailed: string;
  }
> = {
  th: {
    title: "รายการทั้งหมด",
    subtitle: "รายการน้ำใจทั้งหมดที่บันทึกไว้ใน Stripe",
    loading: "กำลังโหลด…",
    unauthorized: "กรุณาเข้าสู่ระบบเพื่อดูรายการ",
    signInLink: "ไปหน้าเข้าสู่ระบบ →",
    loadError: "โหลดรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    empty: "ยังไม่มีรายการ",
    colTime: "เวลา",
    colName: "ชื่อผู้ส่ง",
    colAmount: "จำนวนเงิน",
    colMessage: "ข้อความ",
    colShowOnScreen: "ขึ้นจอ",
    colStatus: "สถานะ",
    noMessage: "—",
    loadMore: "โหลดเพิ่มเติม",
    loadingMore: "กำลังโหลด…",
    searchPlaceholder: "ค้นหาชื่อหรือข้อความ…",
    filterAll: "ทุกสถานะ",
    signOut: "ออกจากระบบ",
    overrideBtn: "บังคับสำเร็จ",
    overrideConfirm: "บังคับให้รายการนี้เป็นสำเร็จ และเล่นการแจ้งเตือนบนสตรีมใหม่?",
    overrideDone: "อัปเดตแล้ว",
    overrideFailed: "ไม่สำเร็จ กรุณาลองใหม่",
    replayBtn: "▶ เล่นซ้ำ",
    replaySent: "ส่งแล้ว ✓",
    replayFailed: "ส่งไม่สำเร็จ กรุณาลองใหม่",
    goalLabel: "เป้าหมาย",
    goalNone: "ยังไม่ได้ตั้งเป้าหมาย",
    totalsLabel: "ยอดรวม",
    statusLabels: {
      PENDING: "รอชำระ",
      SUCCESS: "สำเร็จ",
      EXPIRED: "หมดอายุ",
      FAILED: "ล้มเหลว",
    },
    loginTitle: "เข้าสู่ระบบผู้ดูแล",
    loginSubtitle: "สำหรับผู้ดูแลระบบเท่านั้น",
    loginEmail: "อีเมล",
    loginPassword: "รหัสผ่าน",
    loginBtn: "เข้าสู่ระบบ",
    loginBusy: "กำลังเข้าสู่ระบบ…",
    loginFailed: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  },
  en: {
    title: "Transactions",
    subtitle: "All tips recorded in Stripe.",
    loading: "Loading…",
    unauthorized: "Please sign in to view transactions.",
    signInLink: "Go to sign-in →",
    loadError: "Could not load transactions. Please try again.",
    empty: "No transactions yet.",
    colTime: "Timestamp",
    colName: "Customer Name",
    colAmount: "Amount",
    colMessage: "Message",
    colShowOnScreen: "Show on Screen",
    colStatus: "Status",
    noMessage: "—",
    loadMore: "Load more",
    loadingMore: "Loading…",
    searchPlaceholder: "Search name or message…",
    filterAll: "All statuses",
    signOut: "Sign out",
    overrideBtn: "Force success",
    overrideConfirm: "Force this order to SUCCESS and replay its on-stream alert?",
    overrideDone: "Updated",
    overrideFailed: "Failed — please try again",
    replayBtn: "▶ Replay",
    replaySent: "Sent ✓",
    replayFailed: "Failed — please try again",
    goalLabel: "Goal",
    goalNone: "No active goal",
    totalsLabel: "Totals",
    statusLabels: {
      PENDING: "Pending",
      SUCCESS: "Succeeded",
      EXPIRED: "Expired",
      FAILED: "Failed",
    },
    loginTitle: "Admin sign-in",
    loginSubtitle: "Authorised users only.",
    loginEmail: "Email",
    loginPassword: "Password",
    loginBtn: "Sign in",
    loginBusy: "Signing in…",
    loginFailed: "Invalid email or password.",
  },
};

export const translations: Record<
  Lang,
  {
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    clearSaved: string;
    anonLabel: string;
    emailHint: string;
    amountLabel: string;
    currencyLabel: string;
    amountHint: (range: string) => string;
    foreignCardOnly: string;
    foreignCardTag: string;
    messageLabel: string;
    messagePlaceholder: string;
    keepSecretLabel: string;
    keepSecretHint: string;
    continueToPayment: string;
    submittingBtn: string;
    amountError: (range: string) => string;
    emailError: string;
    genericError: string;
    paymentTitle: string;
    chargeNote: (money: string) => string;
    methodLabel: string;
    methodRemembered: string;
    methodPromptPay: string;
    methodPromptPaySub: string;
    methodCard: string;
    methodCardSub: string;
    promptpayThbOnly: string;
    emailReceiptLabel: string;
    showQrBtn: string;
    editMessageLink: string;
    cardPayBtn: (money: string) => string;
    cardProcessing: string;
    cardError: string;
    qrEyebrow: string;
    qrAlt: string;
    previewFrom: string;
    qrHelp1: string;
    qrHelp2: string;
    qrWaiting: string;
    qrAutoDetect: string;
    timerLabel: string;
    backLink: string;
    successPreviewLabel: string;
    successTitle: string;
    successSubtitleWithAmount: (money: string) => string;
    successSubtitleNoAmount: string;
    successSubtitleHidden: string;
    sendAnotherBtn: string;
    expiredTitle: string;
    expiredSubtitle: string;
    tryAgainBtn: string;
    footer: string;
    supportersTopTitle: string;
    supportersRecentTitle: string;
    supportersCount: (n: number) => string;
    tippedPhrase: (name: string, money: string) => string;
    anonymousLabel: string;
    timeframeWeek: string;
    timeframeMonth: string;
    timeframe90d: string;
    timeframeYear: string;
    timeframeAll: string;
    supportersEmptyTop: string;
    supportersEmptyRecent: string;
    supportersLoadError: string;
  }
> = {
  th: {
    title: "ฝากข้อความ",
    subtitle:
      "ฝากชื่อและข้อความเพื่อขึ้นจอในระหว่างที่แนร์กำลังไลฟ์ ข้อความของคุณอาจถูกอ่านออกเสียงสดในสตรีมด้วยนะคะ",
    nameLabel: "ชื่อของคุณ",
    namePlaceholder: "Anonymous",
    clearSaved: "ไม่ใช่คุณ? ล้างข้อมูล",
    anonLabel: "ไม่ระบุตัวตน — ไม่แสดงชื่อบนสตรีม",
    emailHint:
      "Stripe กำหนดให้ต้องใช้อีเมลเพื่อออกใบเสร็จการชำระเงิน อีเมลนี้จะถูกใช้เพื่อจุดประสงค์ดังกล่าวเท่านั้น และจะไม่ถูกเก็บรวบรวม จัดเก็บ หรือแสดงผลใดๆ ทั้งสิ้น",
    amountLabel: "จำนวนเงิน",
    currencyLabel: "สกุลเงิน",
    amountHint: (range) => `จำนวนเงินต้องอยู่ระหว่าง ${range}`,
    foreignCardOnly: "สกุลเงินอื่นนอกจากเงินบาท (THB) ชำระผ่านบัตรเท่านั้น",
    foreignCardTag: "บัตรเท่านั้น",
    messageLabel: "ข้อความ (ไม่บังคับ)",
    messagePlaceholder: "มีอะไรฝากถึงน้องแนมั้ยคะ~",
    keepSecretLabel: "เก็บเป็นความลับระหว่างเรา",
    keepSecretHint: "ข้อความของคุณจะไม่แสดงบนสตรีมหรือหน้าเพจ มีแค่น้องแนร์คนเดียวที่อ่านได้ค่ะ",
    continueToPayment: "ไปหน้าชำระเงิน",
    submittingBtn: "กำลังเตรียมการชำระเงิน…",
    amountError: (range) => `จำนวนเงินต้องอยู่ระหว่าง ${range}`,
    emailError: "กรุณากรอกอีเมลให้ถูกต้อง",
    genericError: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    paymentTitle: "ชำระเงิน",
    chargeNote: (money) => `ยอดที่จะชำระ ${money}`,
    methodLabel: "วิธีชำระเงิน",
    methodRemembered: "จำไว้",
    methodPromptPay: "พร้อมเพย์",
    methodPromptPaySub: "สแกน QR",
    methodCard: "บัตรเครดิต/เดบิต",
    methodCardSub: "Visa · Mastercard",
    promptpayThbOnly: "พร้อมเพย์รองรับเฉพาะเงินบาท (THB)",
    emailReceiptLabel: "อีเมล (สำหรับใบเสร็จ)",
    showQrBtn: "แสดง QR พร้อมเพย์",
    editMessageLink: "← แก้ไขข้อความ",
    cardPayBtn: (money) => `จ่าย ${money}`,
    cardProcessing: "กำลังดำเนินการ…",
    cardError: "การชำระเงินไม่สำเร็จ กรุณาตรวจสอบข้อมูลบัตรแล้วลองใหม่อีกครั้ง",
    qrEyebrow: "สแกนเพื่อจ่าย",
    qrAlt: "คิวอาร์โค้ดพร้อมเพย์",
    previewFrom: "จากคุณ ✦",
    qrHelp1: "สแกนด้วยแอปธนาคารของคุณเพื่อชำระเงินให้เสร็จสมบูรณ์",
    qrHelp2: "สแกนไม่ได้ใช่ไหม? เปิดหน้าชำระเงิน →",
    qrWaiting: "กำลังรอการชำระเงิน…",
    qrAutoDetect: "ระบบจะตรวจพบการชำระเงินของคุณโดยอัตโนมัติ ไม่ต้องรีเฟรชหน้านี้",
    timerLabel: "หมดอายุใน",
    backLink: "← เริ่มใหม่",
    successPreviewLabel: "ตัวอย่างที่จะขึ้นบนสตรีม",
    successTitle: "ป้อนอาหารน้องแนร์สำเร็จ!",
    successSubtitleWithAmount: (money) =>
      `ข้อความของคุณถูกส่งแล้วพร้อมกับ ${money} จะขึ้นแสดงบนสตรีมในไม่ช้า`,
    successSubtitleNoAmount: "ข้อความของคุณถูกส่งแล้ว จะขึ้นแสดงบนสตรีมในไม่ช้า",
    successSubtitleHidden: "ส่งน้ำใจของคุณสำเร็จแล้วค่ะ",
    sendAnotherBtn: "ส่งอีกครั้ง",
    expiredTitle: "QR หมดอายุแล้ว",
    expiredSubtitle:
      "หากคุณชำระเงินไปแล้ว สามารถแจ้งแนร์ในแชทได้เลย ระบบจะดำเนินการให้โดยอัตโนมัติ หรือหากยังไม่ได้จ่าย สามารถลองใหม่อีกครั้งได้นะ",
    tryAgainBtn: "ลองอีกครั้ง",
    footer:
      "นี่คือการซื้อบริการสวมบทบาทดิจิทัล (ข้อความบนหน้าจอและการอ่านออกเสียงด้วยระบบสังเคราะห์เสียง) ไม่ใช่การบริจาคเพื่อการกุศล",
    supportersTopTitle: "ผู้สนับสนุนอันดับต้น",
    supportersRecentTitle: "ผู้สนับสนุนล่าสุด",
    supportersCount: (n) => `${n} ผู้สนับสนุน`,
    tippedPhrase: (name, money) => `${name} ให้ทิป ${money}`,
    anonymousLabel: "ไม่ระบุตัวตน",
    timeframeWeek: "สัปดาห์นี้",
    timeframeMonth: "เดือนนี้",
    timeframe90d: "90 วัน",
    timeframeYear: "ปีนี้",
    timeframeAll: "ทั้งหมด",
    supportersEmptyTop: "ยังไม่มีทิปในช่วงนี้",
    supportersEmptyRecent: "เป็นคนแรกที่ส่งทิปเลยนะ!",
    supportersLoadError: "โหลดรายชื่อผู้สนับสนุนไม่สำเร็จ",
  },
  en: {
    title: "Send a Message",
    subtitle:
      "Leave a name and a message for an on-screen shoutout while Naire's live. Your message can be read aloud on stream.",
    nameLabel: "Your name",
    namePlaceholder: "Anonymous",
    clearSaved: "Not you? Clear",
    anonLabel: "Stay anonymous — hide my name on stream",
    emailHint:
      "Stripe requires an email address to issue a payment receipt. This email is used solely for that purpose and is not collected, stored, or displayed by us — it's saved only on this device to fill in faster next time.",
    amountLabel: "Amount",
    currencyLabel: "Currency",
    amountHint: (range) => `Amount must be between ${range}.`,
    foreignCardOnly: "Currencies other than Thai Baht are paid by card only.",
    foreignCardTag: "Card only",
    messageLabel: "Message (optional)",
    messagePlaceholder: "Say something nice~",
    keepSecretLabel: "Keep this secret between us",
    keepSecretHint: "Your tip won't appear on stream ✿ it stays just between you and Naire.",
    continueToPayment: "Continue to Payment",
    submittingBtn: "Setting up payment…",
    amountError: (range) => `Amount must be between ${range}.`,
    emailError: "Please enter a valid email address.",
    genericError: "Something went wrong. Please try again.",
    paymentTitle: "Payment",
    chargeNote: (money) => `You'll be charged ${money}`,
    methodLabel: "Payment method",
    methodRemembered: "remembered",
    methodPromptPay: "PromptPay",
    methodPromptPaySub: "Scan QR",
    methodCard: "Credit / Debit Card",
    methodCardSub: "Visa · Mastercard",
    promptpayThbOnly: "PromptPay accepts Thai Baht (THB) only.",
    emailReceiptLabel: "Email (for your receipt)",
    showQrBtn: "Show PromptPay QR",
    editMessageLink: "← Edit message",
    cardPayBtn: (money) => `Pay ${money}`,
    cardProcessing: "Processing…",
    cardError: "Payment failed. Please check your card details and try again.",
    qrEyebrow: "Scan to Pay",
    qrAlt: "PromptPay QR code",
    previewFrom: "Tipped From ✦",
    qrHelp1: "Scan with your banking app to complete payment.",
    qrHelp2: "Trouble scanning? Open payment page →",
    qrWaiting: "Waiting for payment…",
    qrAutoDetect: "We'll detect your payment automatically — no need to refresh this page.",
    timerLabel: "Expires in",
    backLink: "← Start over",
    successPreviewLabel: "Here's your on-stream preview",
    successTitle: "Thank you!",
    successSubtitleWithAmount: (money) =>
      `Your message has been sent along with ${money}. It'll show up on stream shortly.`,
    successSubtitleNoAmount: "Your message has been sent. It'll show up on stream shortly.",
    successSubtitleHidden: "Your kindness has been sent.",
    sendAnotherBtn: "Send another",
    expiredTitle: "QR Expired",
    expiredSubtitle:
      "If you already paid, let Naire know in chat — it'll still go through automatically. Otherwise, feel free to try again.",
    tryAgainBtn: "Try again",
    footer:
      "This is a purchase for a digital roleplay service (on-screen message & text-to-speech). This is not a charitable donation.",
    supportersTopTitle: "Top Supporters",
    supportersRecentTitle: "Recent Supporters",
    supportersCount: (n) => `${n} Supporters`,
    tippedPhrase: (name, money) => `${name} tipped ${money}`,
    anonymousLabel: "Anonymous",
    timeframeWeek: "Week",
    timeframeMonth: "Month",
    timeframe90d: "90 Days",
    timeframeYear: "Year",
    timeframeAll: "All time",
    supportersEmptyTop: "No tips yet in this period.",
    supportersEmptyRecent: "Be the first to tip!",
    supportersLoadError: "Couldn't load supporters.",
  },
};
