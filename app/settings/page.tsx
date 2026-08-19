"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  type Emotion, type Scene, type Device, type DeviceEmotionImages, type DeviceSceneImages,
  type IdleLine, type VoiceTemplate, type ConditionTag, type TimeTag, type WeatherTag, type GuestTag,
  type AlertConfig, type AlertMode, type AlertPreset,
  type JarConfig, type JarMode, type JarPreset, type JarFill, type JarTexture, type JarBacking, type JarAlign,
  TIME_TAGS, WEATHER_TAGS, GUEST_TAGS, PICK_TEMPLATE_DEFAULT, THANKS_TEMPLATE_DEFAULT,
  ALERT_PRESETS, DEFAULT_ALERT_CONFIG, ALERT_DURATION_RANGE, ALERT_MIN_AMOUNT_RANGE, ALERT_SPAWN_GAP_RANGE, ALERT_TTS_THRESHOLD_RANGE, ALERT_VOLUME_RANGE,
  JAR_PRESETS, DEFAULT_JAR_CONFIG, JAR_HEIGHT_RANGE, jarFillCss, jarBackingCss,
  pickIdleLine, renderTemplate, renderAlertTemplate, renderHtmlTemplate,
} from "@/lib/cafe";
import { DEFAULT_PRIVACY, type ModerationAction, type PrivacyConfig } from "@/lib/moderation";

// ── fonts (same three pixel families the tip page / dashboard use) ──────────
const mono = "var(--font-silkscreen), monospace";
const dot = "var(--font-dotgothic), monospace";

type Tab = "cafe" | "menu" | "goal" | "voice" | "alerts" | "jar" | "privacy";

// Per-tab shell width. Each value = the tab's natural content width + the
// 214px nav rail + the 16px nav/content gap + 36px card padding, so the card
// hugs its content instead of leaving a lopsided void on the wider tabs. The
// width animates between these on tab switch (see `.settings-shell` in
// globals.css). maxWidth:100% still guards narrow viewports.
const SHELL_WIDTH: Record<Tab, number> = {
  cafe: 1000,    // single-column form, content capped ~720
  goal: 1260,    // 680 form + 300 preview rail
  voice: 1300,   // moments column + 320 detail rail
  alerts: 1300,  // two equal columns
  jar: 1300,     // two equal columns
  privacy: 1300, // two equal columns
  menu: 1400,    // roomy card grid
};
type Tail = { th: string; en: string };
type MenuItem = { id: string; th: string; en: string; price_thb: number; hidden: boolean; sort_order: number; tails: Tail[]; tags: string[]; thumb_url: string | null };
type GoalEnding = "raise" | "hold" | "hide";
type GoalState = {
  label: string; targetThb: number; isActive: boolean;
  deadline: string | null; ending: GoalEnding;
  showOnCounter: boolean; showOnOverlay: boolean; showOnShare: boolean;
};
type QueueItem = { payment_intent_id: string; customer_name: string; message: string | null; amount_minor: number; currency: string; created_at: string; moderation_reason: string | null; moderation_word: string | null };
type LogItem = { what: string; count: number };

// One slice per panel that the top-right "Save changes" button actually
// writes (Menu excludes itself — it persists per-action, not in this batch).
// Diffing against the last-saved copy drives the unsaved-changes nav badges
// and the leave-page confirmation.
type SaveSnapshot = {
  cafe: { name: string; flowerOfMonth: string; emotionImages: DeviceEmotionImages; sceneImages: DeviceSceneImages };
  voice: { idleLines: IdleLine[]; pickTemplate: VoiceTemplate; thanksTemplate: VoiceTemplate; currentWeather: WeatherTag | null };
  privacy: PrivacyConfig;
  alerts: { mode: AlertMode; preset: AlertPreset | null; html: string; css: string; js: string; durationSec: number; minAmountThb: number; spawnGapSec: number; soundOn: boolean; ttsOn: boolean; soundVolume: number; ttsThresholdThb: number; realVoiceOn: boolean };
  jar: { mode: JarMode; preset: JarPreset | null; html: string; css: string; js: string; fill: JarFill; texture: JarTexture; backing: JarBacking; heightPx: number; showName: boolean; showPct: boolean; showAmount: boolean; align: JarAlign };
  goal: { label: string; targetThb: number; active: boolean; deadline: string; ending: GoalEnding; showOnCounter: boolean; showOnOverlay: boolean; showOnShare: boolean };
  // Treat-tails live on menu-item rows but are authored on the Voice page now
  // (Menu panel keeps only name/price/photo/tags). Tracked here so tail edits
  // batch behind the same "Save changes" and feed the unsaved-changes UI; sorted
  // by id so the compare is stable regardless of menu ordering.
  voiceTails: { id: string; tails: Tail[] }[];
};

// Stable, id-sorted view of every treat's tails — the voiceTails snapshot slice.
function tailsSnapshotOf(items: MenuItem[]): { id: string; tails: Tail[] }[] {
  return items.map((i) => ({ id: i.id, tails: i.tails })).sort((a, b) => a.id.localeCompare(b.id));
}

const EMPTY_EMOTIONS_ONE = { neutral: null, smile: null, sad: null, sparkle: null };
const EMPTY_SCENES_ONE = { day: null, dusk: null, night: null };
const EMPTY_EMOTIONS: DeviceEmotionImages = { mobile: EMPTY_EMOTIONS_ONE, desktop: EMPTY_EMOTIONS_ONE };
const EMPTY_SCENES: DeviceSceneImages = { mobile: EMPTY_SCENES_ONE, desktop: EMPTY_SCENES_ONE };

// Suggested tags offered in the picker (from the design's TAGS list); the
// creator can also type a new one. Guests filter the counter by these.
const SUGGESTED_TAGS = ["tea", "coffee", "soft drink", "iced", "hot", "frappé", "bakery", "bread", "thai dessert", "cake", "seasonal"];

const TREAT_DITHER = "repeating-linear-gradient(135deg,#EEDCBE 0 6px,#E7D2B0 6px 12px)";
function cardThumbBg(url: string | null): string {
  return url ? `center / cover no-repeat url("${url}")` : TREAT_DITHER;
}

const S = {
  th: {
    subtitle: "ตั้งค่าร้าน", backDash: "← แดชบอร์ด", signOut: "ออกจากระบบ",
    tCafe: "ร้าน", tMenu: "เมนู", tGoal: "เป้าหมาย", tVoice: "เสียงของแนร์", tJar: "แถบเป้าหมาย", tPrivacy: "ความเป็นส่วนตัว",
    saveChanges: "บันทึกการแก้ไข", saving: "กำลังบันทึก…", cafeLinkLabel: "ลิงก์ร้าน", liveWord: "เปิดให้บริการ",
    navHint: "หมวดการตั้งค่า", navHere: "อยู่ตรงนี้", navUnsaved: "ยังไม่ได้บันทึก",
    leaveConfirm: "มีการแก้ไขที่ยังไม่ได้บันทึก ออกจากหน้านี้เลยไหม?",
    loading: "กำลังโหลด…", unauthorized: "กรุณาเข้าสู่ระบบเพื่อตั้งค่าร้าน", signIn: "ไปหน้าเข้าสู่ระบบ →",
    error: "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่", saved: "บันทึกแล้ว ✓", saveFail: "บันทึกไม่สำเร็จ กรุณาลองใหม่", deleted: "ลบแล้ว",
    save: "บันทึก", cancel: "ยกเลิก",
    cafeName: "ชื่อร้าน", cafeFlower: "ดอกไม้ประจำเดือน", cafeFlowerHint: "ใส่แค่ชื่อดอกไม้ เช่น \"Jasmine\" — เดือนจะเติมให้อัตโนมัติ",
    menuTitle: "รายการเมนู", menuAdd: "+ เพิ่มเมนู", menuTh: "ชื่อ (ไทย)", menuEn: "ชื่อ (อังกฤษ)",
    menuPrice: "ราคา (บาท)", menuOrder: "ลำดับ", menuHidden: "ซ่อนจากหน้าร้าน", menuTails: "คำพูดตอนเลือกเมนู",
    menuAddTail: "+ เพิ่มคำพูด", menuEdit: "แก้ไข", menuDelete: "ลบ", menuDeleteConfirm: "ลบเมนูนี้เลยไหม?",
    menuEmpty: "ยังไม่มีเมนู",
    menuAddTreat: "+ เพิ่มเมนู", menuSearch: "ค้นหา — ชื่อหรือแท็ก",
    shelvesTitle: "บนหน้าร้าน", bookTitle: "ในสมุดเมนู",
    shelvesNote: "ลากเพื่อจัดลำดับ · ลากข้ามโซนเพื่อซ่อน/แสดง", bookNote: "เก็บไว้แต่ไม่โชว์บนหน้าร้าน",
    shelvesEmpty: "ยังไม่มีเมนูบนหน้าร้าน — ลากขึ้นมาจากสมุด", bookEmpty: "สมุดว่าง — ทุกเมนูอยู่บนหน้าร้านแล้ว",
    menuMoveUp: "ย้ายขึ้น", menuMoveDown: "ย้ายลง",
    edPhoto: "รูปเมนู", edPhotoHint: "ลากรูปมาวาง หรือกดเพื่อเลือก", edPhotoChange: "เปลี่ยนรูป", uploading: "กำลังอัปโหลด…",
    edOnShelf: "แสดงบนหน้าร้าน", edNoTags: "ยังไม่มีแท็ก", edTags: "แท็ก",
    tagSearch: "ค้นหา หรือพิมพ์แท็กใหม่", tagCreate: (t: string) => `สร้าง "${t}"`,
    done: "เสร็จ", previewTitle: "มุมมองลูกค้า", tagAll: "ทั้งหมด", noPhoto: "ยังไม่มีรูป",
    goalLabel: "ชื่อเป้าหมาย", goalTarget: "เป้าหมาย (บาท · 20–70,000)", goalActive: "แสดงบนหน้าร้าน",
    goalNone: "ยังไม่ได้ตั้งเป้าหมาย",
    goalStatusLive: "กำลังแสดงอยู่", goalStatusEnded: "ปิดแล้ว",
    goalEndBtn: "ปิดเป้าหมาย", goalEndConfirm: "ปิดเป้าหมายนี้ตอนนี้เลยไหม? แถบจะหายจากหน้าร้านและโอเวอร์เลย์ทันที",
    goalResumeBtn: "เปิดเป้าหมายอีกครั้ง",
    goalDeadlineLabel: "วันครบกำหนด", goalClear: "ล้างวันที่",
    goalDeadlineNoteSet: (d: string) => `แสดงให้ลูกค้าเห็นว่า "ถึง ${d}"`,
    goalDeadlineNoteEmpty: "ไม่ใส่วันที่ก็ได้ แถบจะเติมไปเรื่อย ๆ ไม่มีวันสิ้นสุด",
    goalEndingTitle: "เมื่อเต็มแล้ว",
    goalEndRaise: "เริ่มโถใหม่", goalEndRaiseNote: "แถบรีเซ็ตแต่ใช้ชื่อเดิม จนกว่าจะเปลี่ยน",
    goalEndHold: "ค้างไว้ที่เต็ม", goalEndHoldNote: "ค้างที่ 100% จนกว่าจะตั้งเป้าหมายใหม่เอง",
    goalEndHide: "เอาแถบออก", goalEndHideNote: "กลับไปเป็นหน้าร้านทิปธรรมดา ไม่มีเป้าหมายให้เห็น",
    goalShowTitle: "แสดงที่ไหนบ้าง",
    goalOnCounter: "บนหน้าร้าน", goalOnCounterNote: "ลูกค้าเห็นว่าใกล้เป้าหมายแค่ไหนก่อนเลือกเมนู",
    goalOnOverlay: "บนโอเวอร์เลย์สตรีม", goalOnOverlayNote: "ควบคุมแถบเป้าหมายบน OBS — ตั้งค่าสไตล์และลิงก์วิดเจ็ตได้ที่แท็บ \"แถบเป้าหมาย\"",
    goalOnShare: "บนการ์ดแชร์", goalOnShareNote: "การ์ดที่ลูกค้าโพสต์จะมีแถบเป้าหมายติดไปด้วย",
    goalCounterPreview: "บนหน้าร้าน", goalRemainingPreview: "เหลืออีก",
    voiceIdle: "ประโยคที่แนร์พูดวนไป", voiceAddLine: "+ เพิ่มประโยค", voiceRemove: "ลบ",
    tailTh: "ไทย", tailEn: "อังกฤษ",
    voiceCounterTitle: "ที่หน้าเคาน์เตอร์", voiceCounterSub: "ตรงกับเงื่อนไขเฉพาะเจาะจงที่สุดจะถูกเลือก",
    voiceMissing: (n: number) => `${n} ประโยคยังแปลไม่ครบ`,
    voiceNoDefault: "ยังไม่มีประโยคที่ไม่ติดเงื่อนไข — ถ้าไม่ตรงเงื่อนไขไหนเลย แนร์จะไม่พูดอะไรเลย",
    voiceAlwaysAvailable: "ใช้ได้เสมอ (ไม่ติดเงื่อนไข)",
    voiceAddCondition: "+ เพิ่มเงื่อนไข", voiceGroupTime: "ช่วงเวลา", voiceGroupWeather: "อากาศ (ของคุณ ไม่ใช่ของลูกค้า)", voiceGroupGuest: "ลูกค้า",
    tagMorning: "เช้า", tagAfternoon: "บ่าย", tagDusk: "โพล้เพล้", tagNight: "กลางคืน",
    tagRain: "ฝนตก", tagClear: "ท้องฟ้าแจ่มใส", tagHot: "อากาศร้อน",
    tagFirst: "มาครั้งแรก", tagReturning: "กลับมาอีกครั้ง", tagTop: "ผู้สนับสนุนสูงสุด", tagAway: "หายไปนาน",
    voiceWeatherTitle: "อากาศวันนี้", voiceWeatherNote: "ตั้งเองตามอากาศจริงของคุณตอนนี้ — ไม่มีข้อมูลอัตโนมัติ",
    voiceWeatherNone: "ไม่ระบุ",
    voiceFramesTitle: "ประโยคสำเร็จรูป", voiceTokensNote: "แตะเพื่อแทรกตัวแปรลงในช่องที่แก้ไขล่าสุด",
    voicePickLabel: "ตอนลูกค้าเลือกเมนู", voicePickNote: "{{line}} จะดึงคำพูดของเมนูนั้นมาใส่ — ใส่ไว้ด้วยนะ",
    voiceThanksLabel: "ตอนยืนยันและบนการ์ดแชร์", voiceThanksNote: "ประโยคที่จะติดไปกับลูกค้า — ให้สั้นพออ่านบนมือถือได้",
    voiceSimTitle: "ลองดูตัวอย่าง", voiceSimTag: "จำลอง",
    voiceSimTreat: "เมนู", voiceSimNone: "ไม่มี",
    voiceSimGreeting: "คำทักทาย", voiceSimPick: "ตอนเลือกเมนู", voiceSimThanks: "ตอนขอบคุณ",
    // ── redesigned Voice page ──
    voiceLiveWeather: "อากาศตอนนี้", voiceLiveWeatherNote: "สลับตามอากาศจริงของคุณตอนนี้ — เปลี่ยนประโยคที่แนร์เลือกและสีหน้าของแนร์บนหน้าร้านทันที",
    voiceMomentBrowse: "ตอนลูกค้าเดินดู", voiceMomentBrowseSub: "ประโยคที่พูดวนไป · ตรงเงื่อนไขเฉพาะเจาะจงสุดถูกเลือก",
    voiceMomentPick: "ตอนลูกค้าเลือกเมนู", voiceMomentPickSub: "ประโยคกรอบ + คำพูดของแต่ละเมนู",
    voiceMomentTip: "หลังลูกค้าจ่ายเงิน", voiceMomentTipSub: "ประโยคขอบคุณบนใบยืนยันและการ์ดแชร์",
    voiceLineSearch: "ค้นหาประโยค…", voiceGroupToggle: "จัดกลุ่มตามเงื่อนไข", voiceLineCount: (n: number) => `${n} ประโยค`,
    voiceListEmpty: "ยังไม่มีประโยค — เพิ่มประโยคแรกได้เลย",
    voiceNoMatch: "ไม่พบประโยคที่ตรงกับคำค้น",
    voiceBucketDefault: "ไม่ติดเงื่อนไข (ประโยคหลัก)",
    voicePickOne: "เลือกประโยคจากรายการเพื่อแก้ไข หรือเพิ่มประโยคใหม่",
    voiceLineFiresAny: "ใช้ได้ทุกเมื่อ (ประโยคหลัก)", voiceLineFiresWhen: "จะพูดเมื่อ:",
    voiceLinePreviewLabel: "ตัวอย่างประโยค", voiceLineWinsBadge: "◀ จะพูดตอนนี้",
    voiceDetailTh: "ภาษาไทย", voiceDetailEn: "ภาษาอังกฤษ",
    voiceTreatEmpty: "ยังไม่มีคำพูดสำหรับเมนูนี้ — เพิ่มสักประโยคสิ",
    voiceTreatAddLine: "+ เพิ่มคำพูด",
    voiceSceneTitle: "ลองเป็นลูกค้าดู", voiceSceneOpen: "เปิด", voiceSceneClose: "ย่อ",
    voiceSceneNote: "ตั้งสถานการณ์สมมติ แล้วดูว่าประโยคไหนจะถูกเลือก และคำพูดตอนเลือกเมนู/ขอบคุณจะออกมาแบบไหน",
    menuTailsMoved: "ย้ายคำพูดตอนเลือกเมนูไปที่หน้า \"เสียงของแนร์\" แล้ว — เขียนคู่กับประโยคกรอบได้ที่นั่น",
    menuTailsMovedCta: "ไปหน้าเสียง →",
    tAlerts: "การแจ้งเตือน",
    alertsPreviewTitle: "ตัวอย่างการแจ้งเตือน",
    alertModeSimple: "ธรรมดา", alertModeCode: "โค้ด",
    alertBehaviorTitle: "พฤติกรรมการแจ้งเตือน",
    alertDuration: "แสดงบนจอ", alertDurationNote: "ระยะเวลาที่การ์ดแจ้งเตือนค้างอยู่ก่อนใบถัดไป",
    alertMinAmount: "จำนวนขั้นต่ำที่แจ้งเตือน", alertMinAmountNote: "ทิปที่น้อยกว่ายังนับรวมในเป้าหมาย แค่ไม่ขึ้นแจ้งเตือน", alertMinAmountEvery: "ทุกทิป",
    alertSpawnGap: "ช่วงห่างระหว่างการแจ้งเตือน", alertSpawnGapNote: "เรดจะกลายเป็นสายธารต่อเนื่อง แทนที่จะถาโถมพร้อมกัน",
    alertRealVoiceTitle: "เสียงจริงของแนร์", alertRealVoiceNote: "สัญญาว่าจะอ่านข้อความด้วยเสียงจริงของคุณเองสด ๆ บนสตรีม แยกจากเสียงสังเคราะห์ที่อ่านการแจ้งเตือนอัตโนมัติด้านล่าง",
    alertRealVoiceLabel: "เปิดใช้คำสัญญาเสียงจริง", alertRealVoiceOffNote: "ปิดแล้วมิเตอร์ปลดล็อกเสียงและหน้าตาตื่นเต้นของแนร์จะไม่แสดงบนหน้าร้าน",
    alertTtsThreshold: "ปลดล็อกเสียงจริงตั้งแต่", alertTtsThresholdNote: "จำนวนที่คุณสัญญาว่าจะอ่านด้วยเสียงจริง เมนูราคาสูงกว่านี้จะมีป้ายบอกตอนเลือก",
    alertSoundLabel: "เล่นเสียงกระดิ่งร้าน", alertSoundNote: "เสียงสั้น ๆ ก่อนแจ้งเตือนแต่ละครั้ง ลองปิดเสียงสตรีมแล้วเทสต์ดูก่อน",
    alertVolume: "ระดับเสียงแจ้งเตือน", alertVolumeNote: "ควบคุมทั้งเสียงกระดิ่งและเสียงอ่านข้อความอัตโนมัติด้านล่าง",
    alertTtsLabel: "อ่านข้อความด้วยเสียงสังเคราะห์ (Google TTS)", alertTtsNote: "อ่านออกเสียงทุกการแจ้งเตือนที่ถึงจำนวนขั้นต่ำโดยอัตโนมัติ ไม่เกี่ยวกับเสียงจริงด้านล่าง",
    alertWidgetTitle: "วิดเจ็ต OBS", alertWidgetUrlLabel: "ลิงก์ Browser Source",
    alertWidgetCopy: "คัดลอก", alertWidgetCopied: "คัดลอกแล้ว ✓",
    alertWidgetRegenerate: "สร้างโทเค็นใหม่",
    alertWidgetRegenerateConfirm: "ลิงก์เดิมจะใช้ไม่ได้ทันที ต้องแปะลิงก์ใหม่ใน OBS ทุกวิดเจ็ต ดำเนินการต่อไหม?",
    alertWidgetRegenerateNote: "โทเค็นเดียวกับที่แถบเป้าหมายจะใช้ในอนาคต — เปลี่ยนพร้อมกันทั้งคู่",
    alertTestBtn: "ทดสอบการแจ้งเตือน", alertTestSent: "ส่งการแจ้งเตือนทดสอบแล้ว ♡",
    alertCodeTitle: "โค้ดการแจ้งเตือน",
    alertCodeNote: "HTML และ CSS ธรรมดาบนพื้นที่ 1920×1080 ใช้ตัวแปรสำหรับผู้ให้ทิป เมนู จำนวนเงิน ข้อความ และรูปเมนู",
    alertPresetPolaroid: "โพลารอยด์", alertPresetReceipt: "ใบเสร็จ", alertPresetBubble: "บับเบิล",
    alertResetCode: "รีเซ็ตโค้ด", alertPreviewTreat: "เมนูตัวอย่าง",
    deviceMobile: "มือถือ", deviceDesktop: "เดสก์ท็อป",
    deviceNote: "ครอปแยกกันสำหรับมือถือ (สี่เหลี่ยมเล็ก) กับเดสก์ท็อป (สี่เหลี่ยมใหญ่) — ไม่ใช่รูปเดียวกัน",
    jarWidgetTitle: "วิดเจ็ตแถบเป้าหมาย", jarWidgetNote: "โทเค็นเดียวกับการแจ้งเตือน — เปลี่ยนพร้อมกันทั้งคู่",
    jarPreviewPctLabel: "ทดลองเปอร์เซ็นต์",
    jarSummaryPct: "ความคืบหน้า", jarSummaryRaised: "ได้รับแล้ว", jarSummaryTarget: "เป้าหมาย", jarNoGoal: "ยังไม่ได้ตั้งเป้าหมาย",
    jarPreviewTitle: "ตัวอย่างแถบเป้าหมาย", jarRedrawNote: "นี่คือตัวอย่าง — วิดเจ็ตจริงบน OBS จะอัปเดตทันทีที่มีทิปเข้า ไม่ต้องรีโหลดฉาก",
    jarStyleTitle: "สไตล์แถบ", jarStyleNote: "ใช้บนสตรีมเท่านั้น — แถบบนหน้าร้านยังคงสไตล์ของคาเฟ่",
    jarFillLabel: "สีเติม", jarTextureLabel: "ลวดลาย", jarBackingLabel: "พื้นหลังแถบ",
    jarTexStripe: "ลาย", jarTexSolid: "เรียบ",
    jarBackCream: "ครีม", jarBackDark: "เข้ม", jarBackOutline: "เส้นขอบ",
    jarHeightLabel: "ความสูงแถบ",
    jarLabelRowTitle: "แสดงป้าย", jarLabelName: "ชื่อเป้าหมาย", jarLabelPct: "เปอร์เซ็นต์", jarLabelAmount: "จำนวนเงิน",
    jarAlignLabel: "ตำแหน่งป้าย", jarAlignLeft: "ซ้าย", jarAlignCenter: "กลาง", jarAlignRight: "ขวา",
    jarResetStyle: "รีเซ็ตเป็นสไตล์คาเฟ่",
    jarCodeTitle: "โค้ดแถบเป้าหมาย",
    jarCodeNote: "HTML และ CSS ธรรมดาบนพื้นที่ 600×90 ใช้ตัวแปรสำหรับชื่อเป้าหมาย ยอดที่ได้ เป้าหมาย และเปอร์เซ็นต์",
    jarPresetBoba: "ชานมไข่มุก", jarPresetShelf: "ชั้นวาง", jarPresetMinimal: "มินิมอล",
    expressionsTitle: "สีหน้าของแนร์", expressionsSub: "ภาพสไตล์วิชวลโนเวล",
    expressionsNote: "ไฟล์ PNG พื้นหลังโปร่งใสของแนร์ หน้าตาจะเปลี่ยนตามสิ่งที่ลูกค้ากำลังทำ",
    emoNeutral: "ปกติ", emoNeutralNote: "หน้าเริ่มต้น",
    emoSmile: "ยิ้ม", emoSmileNote: "ตอนเลือกเมนู",
    emoSad: "เศร้า", emoSadNote: "ยังไม่เชื่อมกับเงื่อนไขอัตโนมัติ",
    emoSparkle: "ตาวาว ✧", emoSparkleNote: "ตอนปลดล็อกเสียงจริง",
    backgroundsTitle: "ฉากหลังหน้าร้าน", backgroundsSub: "ใส่รูปในแต่ละช่วงเวลา",
    sceneDay: "กลางวัน", sceneDayNote: "ก่อน 17:00 (เวลาของลูกค้า)",
    sceneDusk: "โพล้เพล้", sceneDuskNote: "17:00–21:00",
    sceneNight: "กลางคืน", sceneNightNote: "หลัง 21:00",
    slotHint: "ลากรูปมาวาง หรือกดเพื่อเลือก",
    filterTitle: "ตัวกรอง", filterSub: "ข้อความและชื่อที่แสดง",
    strictOff: "ปิด", strictStandard: "มาตรฐาน",
    strictNoteOff: "ไม่มีการกรองใด ๆ ทุกข้อความขึ้นจอตามที่พิมพ์เป๊ะ ๆ — คุณดูแลเองสด ๆ",
    strictNoteStandard: "ใช้รายการคำไทย+อังกฤษที่มีอยู่แล้ว จับคำเต็มคำ แทบไม่มี false positive แต่คนตั้งใจก็ยังหลบได้",
    actMessage: "คำต้องห้ามในข้อความ", actMessageNote: "สิ่งที่ขึ้นจอและหน้าร้าน",
    actName: "คำต้องห้ามในชื่อที่แสดง", actNameNote: "ชื่อขึ้นทุกครั้งที่มีการแจ้งเตือน แม้ไม่มีข้อความ",
    actTts: "คำต้องห้ามก่อนอ่านออกเสียง", actTtsNote: "อนุมัติให้ขึ้นจอ ไม่ได้แปลว่าอนุมัติให้อ่านออกเสียงด้วย",
    aMask: "กลบคำ", aHold: "รอตรวจ", aBlock: "บล็อก",
    blockTitle: "บล็อกคำเหล่านี้เพิ่ม", blockNote: "เพิ่มจากรายการที่มีอยู่แล้ว — มุกในกลุ่ม ชื่อแฟนเก่า หรือชื่อที่ไม่อยากเห็น",
    allowTitle: "อนุญาตคำเหล่านี้เสมอ", allowNote: "ภาษาไทยโดนจับผิดบ่อย คำในนี้จะไม่ถูกกักไว้เลย ไม่ว่าตั้งค่าไว้ยังไง",
    wordPlaceholder: "คำหรือชื่อ",
    addWordBtn: "เพิ่ม", importBtn: "⇪ นำเข้าไฟล์", importHint: ".txt / .csv / .json — บรรทัดละคำ คั่นด้วยจุลภาค หรือ JSON array",
    holdTitle: "กักไว้ตรวจก่อน", holdNote: "สิ่งที่รายการคำจับไม่ได้ ข้อความที่ถูกกักจะรอในคิว — เงินทิปยังเข้าปกติ",
    holdFirstTime: "ข้อความแรกจากผู้สนับสนุนใหม่", holdFirstTimeNote: "ดูครั้งเดียวแล้วเชื่อใจได้เลย",
    holdLinks: "ลิงก์และ @mention", holdLinksNote: "วิธีที่พบบ่อยที่สุดของการก่อกวน",
    holdLong: "ยาวกว่า 200 ตัวอักษร", holdLongNote: "ข้อความยาวจะค้างอยู่บนจอนาน",
    holdCaps: "พิมพ์ตัวใหญ่ทั้งหมด", holdCapsNote: "ฟังดูเหมือนตะโกนบนสตรีม กักไว้ ไม่บล็อก",
    holdRepeat: "อักษรซ้ำติดกัน (aaaaaa)", holdRepeatNote: "จับวิธีเว้นวรรคหลบตัวกรองด้วย",
    queueOnLabel: "เปิดระบบกักตรวจข้อความ", queueOnNote: "ปิดแล้ว = ทุกอย่างที่ไม่ถูกบล็อกจะขึ้นจอทันที",
    anonDefaultLabel: "ไม่ระบุตัวตนเป็นค่าเริ่มต้น", anonDefaultNote: "ช่องชื่อจะว่างไว้ก่อน ผู้สนับสนุนต้องเลือกเองถ้าอยากให้ระบุชื่อ",
    sealedLabel: "อนุญาตข้อความปิดผนึก", sealedNote: "ผู้สนับสนุนเลือกให้ข้อความเป็นส่วนตัวได้ — ถึงคุณเท่านั้น ไม่ขึ้นจอ ไม่อ่านออกเสียง",
    guestPrivacyTitle: "ความเป็นส่วนตัวของผู้สนับสนุน",
    queueTitle: "คิวรอตรวจ", queueEmpty: "ไม่มีอะไรรอตรวจอยู่ ข้อความที่ถูกกักจะมาอยู่ตรงนี้",
    approve: "อนุมัติ", reject: "ปฏิเสธ", remember: (w: string) => `อนุมัติและอนุญาตคำว่า "${w}" ตลอดไป`,
    logTitle: "บันทึกการบล็อก", logSub: "7 วันล่าสุด", logEmpty: "ยังไม่มีอะไรถูกบล็อกใน 7 วันนี้",
  },
  en: {
    subtitle: "Café settings", backDash: "← Dashboard", signOut: "SIGN OUT",
    tCafe: "Café", tMenu: "Menu", tGoal: "Goal", tVoice: "Voice", tJar: "Goal bar overlay", tPrivacy: "Privacy & moderation",
    saveChanges: "Save changes", saving: "Saving…", cafeLinkLabel: "CAFÉ LINK", liveWord: "live",
    navHint: "SETTINGS", navHere: "YOU ARE HERE", navUnsaved: "UNSAVED",
    leaveConfirm: "You have unsaved changes. Leave this page anyway?",
    loading: "Loading…", unauthorized: "Please sign in to manage café settings.", signIn: "Go to sign-in →",
    error: "Couldn't load data. Please try again.", saved: "Saved ✓", saveFail: "Save failed — please try again.", deleted: "Deleted",
    save: "Save", cancel: "Cancel",
    cafeName: "Café name", cafeFlower: "Flower of the month", cafeFlowerHint: "Just the flower, e.g. \"Jasmine\" — the month is added automatically.",
    menuTitle: "Menu items", menuAdd: "+ Add item", menuTh: "Name (Thai)", menuEn: "Name (English)",
    menuPrice: "Price (THB)", menuOrder: "Sort order", menuHidden: "Hidden from the tip page", menuTails: "Dialogue tails on pick",
    menuAddTail: "+ Add tail", menuEdit: "Edit", menuDelete: "Delete", menuDeleteConfirm: "Delete this menu item?",
    menuEmpty: "No menu items yet",
    menuAddTreat: "+ Add a treat", menuSearch: "search — name or tag",
    shelvesTitle: "On the shelves", bookTitle: "In the book",
    shelvesNote: "Drag to reorder · drag across a zone to show / hide", bookNote: "Kept, but off the counter",
    shelvesEmpty: "Nothing on the shelves — drag a treat up from the book.", bookEmpty: "The book is empty — everything's out on the shelves.",
    menuMoveUp: "Move up", menuMoveDown: "Move down",
    edPhoto: "Photo", edPhotoHint: "Drop an image or click to choose", edPhotoChange: "Change photo", uploading: "Uploading…",
    edOnShelf: "On the shelves", edNoTags: "no tags yet", edTags: "Tags",
    tagSearch: "search or name a new tag", tagCreate: (t: string) => `Create "${t}"`,
    done: "Done", previewTitle: "Guest's view", tagAll: "everything", noPhoto: "no photo",
    goalLabel: "Goal label", goalTarget: "Target (THB · 20–70,000)", goalActive: "Show on the tip page",
    goalNone: "No goal set yet",
    goalStatusLive: "Live", goalStatusEnded: "Ended",
    goalEndBtn: "End goal", goalEndConfirm: "End this goal now? It disappears from the tip page and overlay immediately.",
    goalResumeBtn: "Resume goal",
    goalDeadlineLabel: "Deadline", goalClear: "clear",
    goalDeadlineNoteSet: (d: string) => `Shown to guests as "until ${d}".`,
    goalDeadlineNoteEmpty: "Leave empty and the jar keeps filling with no end date.",
    goalEndingTitle: "When the jar fills",
    goalEndRaise: "Start the next jar", goalEndRaiseNote: "The bar resets and keeps the same name until you change it.",
    goalEndHold: "Hold at full", goalEndHoldNote: "Stays at 100% until you set a new goal yourself.",
    goalEndHide: "Take the bar down", goalEndHideNote: "The counter goes back to plain tipping, no goal shown.",
    goalShowTitle: "Where it shows",
    goalOnCounter: "On the café counter", goalOnCounterNote: "Guests see how close you are before they pick.",
    goalOnOverlay: "On the stream overlay", goalOnOverlayNote: "Controls the OBS goal bar — style it and grab its widget link from the \"Goal bar overlay\" tab.",
    goalOnShare: "On share cards", goalOnShareNote: "Every card a guest posts carries the jar with it.",
    goalCounterPreview: "On the counter", goalRemainingPreview: "Left to go",
    voiceIdle: "Idle lines Naire cycles through", voiceAddLine: "+ Add line", voiceRemove: "Remove",
    tailTh: "Thai", tailEn: "English",
    voiceCounterTitle: "At the counter", voiceCounterSub: "Most specific match wins",
    voiceMissing: (n: number) => `${n} line${n > 1 ? "s" : ""} still untranslated`,
    voiceNoDefault: "No untagged line — if nothing matches, she says nothing at all.",
    voiceAlwaysAvailable: "always available",
    voiceAddCondition: "+ Add condition", voiceGroupTime: "TIME OF DAY", voiceGroupWeather: "WEATHER — yours, not theirs", voiceGroupGuest: "GUEST",
    tagMorning: "morning", tagAfternoon: "afternoon", tagDusk: "dusk", tagNight: "night",
    tagRain: "rain", tagClear: "clear", tagHot: "hot",
    tagFirst: "first visit", tagReturning: "returning", tagTop: "top supporter", tagAway: "been away",
    voiceWeatherTitle: "Today's weather", voiceWeatherNote: "Set by hand from your real weather — nothing automatic here.",
    voiceWeatherNone: "Not set",
    voiceFramesTitle: "The frames", voiceTokensNote: "Tap to insert into the last field you edited.",
    voicePickLabel: "WHEN A GUEST PICKS A TREAT", voicePickNote: "{{line}} pulls the treat's own line from the menu — leave it in.",
    voiceThanksLabel: "ON THE CONFIRMATION AND SHARE CARD", voiceThanksNote: "The line that travels — keep it short enough to read on a phone.",
    voiceSimTitle: "Try it out", voiceSimTag: "SIMULATED",
    voiceSimTreat: "TREAT", voiceSimNone: "none",
    voiceSimGreeting: "Greeting", voiceSimPick: "On pick", voiceSimThanks: "Thanks",
    // ── redesigned Voice page ──
    voiceLiveWeather: "Weather right now", voiceLiveWeatherNote: "Flip this to your real weather — it changes which lines Naire picks and her expression on the café, live.",
    voiceMomentBrowse: "While they browse", voiceMomentBrowseSub: "Idle lines · most specific match wins",
    voiceMomentPick: "When they pick a treat", voiceMomentPickSub: "The wrapper line + each treat's own dialogue",
    voiceMomentTip: "After they tip", voiceMomentTipSub: "The thank-you on the confirmation and share card",
    voiceLineSearch: "Search lines…", voiceGroupToggle: "Group by condition", voiceLineCount: (n: number) => `${n} line${n === 1 ? "" : "s"}`,
    voiceListEmpty: "No lines yet — add your first below.",
    voiceNoMatch: "No lines match your search.",
    voiceBucketDefault: "Untagged (defaults)",
    voicePickOne: "Pick a line from the list to edit it — or add a new one.",
    voiceLineFiresAny: "Available any time (default)", voiceLineFiresWhen: "Fires when:",
    voiceLinePreviewLabel: "Line preview", voiceLineWinsBadge: "◀ fires now",
    voiceDetailTh: "Thai", voiceDetailEn: "English",
    voiceTreatEmpty: "No line for this treat yet — add one.",
    voiceTreatAddLine: "+ Add a line",
    voiceSceneTitle: "Preview as a guest", voiceSceneOpen: "Open", voiceSceneClose: "Collapse",
    voiceSceneNote: "Set a hypothetical scene and see which idle line wins, plus how the pick and thank-you render.",
    menuTailsMoved: "A treat's dialogue lines now live on the Voice page — author them beside the pick template there.",
    menuTailsMovedCta: "Go to Voice →",
    tAlerts: "Alerts",
    alertsPreviewTitle: "Tip alert · preview",
    alertModeSimple: "SIMPLE", alertModeCode: "CODE",
    alertBehaviorTitle: "Alert behaviour",
    alertDuration: "ALERT ON SCREEN", alertDurationNote: "How long one alert stays before the next is released.",
    alertMinAmount: "MINIMUM TO ALERT", alertMinAmountNote: "Smaller tips still count toward the goal bar — they just don't interrupt.", alertMinAmountEvery: "every tip",
    alertSpawnGap: "GAP BETWEEN ALERTS", alertSpawnGapNote: "A raid becomes a steady stream instead of a flood.",
    alertRealVoiceTitle: "Naire's real voice", alertRealVoiceNote: "The promise to read a message in your own real voice, live on stream — separate from the synthesized read-aloud below.",
    alertRealVoiceLabel: "Enable the real-voice promise", alertRealVoiceOffNote: "Off hides the unlock meter and sparkle face from the tip page entirely.",
    alertTtsThreshold: "REAL VOICE UNLOCKS FROM", alertTtsThresholdNote: "The amount you promise to read yourself, live. Treats priced above it show the badge on the counter.",
    alertSoundLabel: "Play the café bell", alertSoundNote: "A short chime under each alert. Test it with the stream muted first.",
    alertVolume: "ALERT VOLUME", alertVolumeNote: "Controls both the chime and the synthesized read-aloud below.",
    alertTtsLabel: "Read messages aloud (Google TTS)", alertTtsNote: "Automatically reads every alert that clears the minimum aloud in a synthesized voice — unrelated to the real-voice promise below.",
    alertWidgetTitle: "OBS widget", alertWidgetUrlLabel: "Browser Source URL",
    alertWidgetCopy: "Copy", alertWidgetCopied: "Copied ✓",
    alertWidgetRegenerate: "Regenerate",
    alertWidgetRegenerateConfirm: "The old link stops working immediately — every OBS widget needs the new one pasted in. Continue?",
    alertWidgetRegenerateNote: "Same token the goal bar overlay will use — regenerating changes both at once.",
    alertTestBtn: "Test alert", alertTestSent: "Test alert sent ♡",
    alertCodeTitle: "Alert code",
    alertCodeNote: "Plain HTML & CSS on the 1920×1080 source. Use the tokens for the buyer, treat, amount, note and dessert photo.",
    alertPresetPolaroid: "Polaroid", alertPresetReceipt: "Receipt", alertPresetBubble: "Bubble",
    alertResetCode: "Reset code", alertPreviewTreat: "PREVIEW TREAT",
    deviceMobile: "Mobile", deviceDesktop: "Desktop",
    deviceNote: "Separate crops for mobile (small square) and desktop (large rectangle) — not the same image.",
    jarWidgetTitle: "Goal bar widget", jarWidgetNote: "Same token as the alert — regenerating changes both at once.",
    jarPreviewPctLabel: "PREVIEW %",
    jarSummaryPct: "Progress", jarSummaryRaised: "Raised", jarSummaryTarget: "Target", jarNoGoal: "No goal set yet",
    jarPreviewTitle: "Goal bar · preview", jarRedrawNote: "This is an example — the real widget on OBS redraws the second a tip clears, no scene refresh needed.",
    jarStyleTitle: "Bar style", jarStyleNote: "Stream only — the bar on the café page keeps its own look.",
    jarFillLabel: "FILL", jarTextureLabel: "TEXTURE", jarBackingLabel: "BACKING",
    jarTexStripe: "Stripe", jarTexSolid: "Solid",
    jarBackCream: "Cream", jarBackDark: "Dark", jarBackOutline: "Outline",
    jarHeightLabel: "BAR HEIGHT",
    jarLabelRowTitle: "LABEL ROW", jarLabelName: "Goal name", jarLabelPct: "Percent", jarLabelAmount: "Amount",
    jarAlignLabel: "LABEL ALIGN", jarAlignLeft: "Left", jarAlignCenter: "Center", jarAlignRight: "Right",
    jarResetStyle: "Reset to café look",
    jarCodeTitle: "Goal bar code",
    jarCodeNote: "Plain HTML & CSS on the 600×90 source. Use the tokens for the goal name, raised amount, target and percent.",
    jarPresetBoba: "Boba", jarPresetShelf: "Shelf", jarPresetMinimal: "Minimal",
    expressionsTitle: "Expressions", expressionsSub: "VISUAL-NOVEL FACES",
    expressionsNote: "Transparent PNGs of Naire, one per mood. The counter swaps to the matching face as guests browse and pick a treat.",
    emoNeutral: "Neutral", emoNeutralNote: "Her resting face.",
    emoSmile: "Smile", emoSmileNote: "When a treat is picked.",
    emoSad: "Sad", emoSadNote: "Not wired to an automatic trigger yet.",
    emoSparkle: "Sparkle ✧", emoSparkleNote: "When her voice unlocks.",
    backgroundsTitle: "Backgrounds", backgroundsSub: "DROP AN IMAGE ON EACH",
    sceneDay: "Counter · day", sceneDayNote: "Before 5pm, guest's local time.",
    sceneDusk: "Counter · dusk", sceneDuskNote: "5–9pm.",
    sceneNight: "Counter · night", sceneNightNote: "After 9pm.",
    slotHint: "Drop an image or click to choose",
    filterTitle: "Filter", filterSub: "MESSAGES & DISPLAY NAMES",
    strictOff: "Off", strictStandard: "Standard",
    strictNoteOff: "Nothing is filtered. Every message reaches the overlay exactly as it was typed — you're moderating live, by yourself.",
    strictNoteStandard: "The built-in Thai + English list, matched on whole words. Almost no false positives; someone determined can still get past it.",
    actMessage: "A flagged word in a message", actMessageNote: "What the overlay and the café page show.",
    actName: "A flagged word in a display name", actNameNote: "Names show on every alert, even with no message.",
    actTts: "A flagged word before read-aloud", actTtsNote: "Approving text for the screen doesn't approve it for your voice.",
    aMask: "MASK", aHold: "HOLD", aBlock: "BLOCK",
    blockTitle: "Also block these", blockNote: "Added on top of the built-in list — fandom in-jokes, an ex's name, a handle you'd rather not see.",
    allowTitle: "Always allow these", allowNote: "Thai flags innocent words constantly. Anything here is never held, whatever the preset says.",
    wordPlaceholder: "a word or a name",
    addWordBtn: "Add", importBtn: "⇪ IMPORT FILE", importHint: ".txt / .csv / .json — one per line, comma-separated, or a JSON array.",
    holdTitle: "Hold for review", holdNote: "Things a word list can't catch. Held messages wait in the queue — the tip still goes through.",
    holdFirstTime: "First message from a new supporter", holdFirstTimeNote: "One look, then they're trusted.",
    holdLinks: "Links and @mentions", holdLinksNote: "The most common way a raid gets weaponised.",
    holdLong: "Longer than 200 characters", holdLongNote: "Walls of text sit on the overlay for a long time.",
    holdCaps: "ALL CAPS", holdCapsNote: "Reads as shouting on stream. Held, not blocked.",
    holdRepeat: "Repeated characters (aaaaaa)", holdRepeatNote: "Also catches the spacing trick people use to dodge filters.",
    queueOnLabel: "Hold questionable messages", queueOnNote: "Off means everything that isn't blocked outright goes straight to the overlay.",
    anonDefaultLabel: "Anonymous by default", anonDefaultNote: "The name box starts empty — guests opt in to being named.",
    sealedLabel: "Allow sealed messages", sealedNote: "Guests can mark a note private — it reaches you, never the overlay or read-aloud.",
    guestPrivacyTitle: "Guest privacy",
    queueTitle: "Queue", queueEmpty: "Nothing waiting. Held messages land here — the guest is told it's on its way to you, not that it was blocked.",
    approve: "Approve", reject: "Reject", remember: (w: string) => `Approve and always allow "${w}"`,
    logTitle: "Blocked log", logSub: "LAST 7 DAYS", logEmpty: "Nothing's been blocked in the last 7 days.",
  },
} as const;

export default function Settings() {
  const [lang, setLang] = useState<Lang>("th");
  const L = S[lang];
  const [tab, setTab] = useState<Tab>("cafe");
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [flash, setFlash] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [origin, setOrigin] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOrigin(window.location.origin); }, []);

  function showFlash(msg: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(msg);
    flashTimer.current = setTimeout(() => setFlash(null), 3200);
  }
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // ── café ──────────────────────────────────────────────────────────────────
  const [cafeName, setCafeName] = useState("");
  const [flower, setFlower] = useState("");
  const [emotionImages, setEmotionImages] = useState<DeviceEmotionImages>(EMPTY_EMOTIONS);
  const [sceneImages, setSceneImages] = useState<DeviceSceneImages>(EMPTY_SCENES);
  const [imageDevice, setImageDevice] = useState<Device>("desktop"); // which device's crops Expressions/Backgrounds are editing
  const [slotUploading, setSlotUploading] = useState<string | null>(null); // key of the slot mid-upload

  // ── voice ─────────────────────────────────────────────────────────────────
  // Note: TTS threshold is deliberately NOT here — it's a Prices concern that
  // belongs to the (not yet built) Alerts overlay panel, not Naire's dialogue.
  const [idleLines, setIdleLines] = useState<IdleLine[]>([]);
  const [pickTemplate, setPickTemplate] = useState<VoiceTemplate>(PICK_TEMPLATE_DEFAULT);
  const [thanksTemplate, setThanksTemplate] = useState<VoiceTemplate>(THANKS_TEMPLATE_DEFAULT);
  const [currentWeather, setCurrentWeather] = useState<WeatherTag | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null); // which idle line the right-rail detail editor is on
  const [lineQuery, setLineQuery] = useState(""); // master-list search
  const [groupByCondition, setGroupByCondition] = useState(false); // bucket the master list by tag-set
  // "Preview as a guest" scene bar — sets a hypothetical context and lights up
  // the idle line that would win under it.
  const [simOpen, setSimOpen] = useState(true);
  const [simTime, setSimTime] = useState<TimeTag>("night");
  const [simWeather, setSimWeather] = useState<WeatherTag | null>(null);
  const [simGuest, setSimGuest] = useState<GuestTag | null>(null);
  const [simTreatId, setSimTreatId] = useState<string | null>(null);

  // ── alerts ────────────────────────────────────────────────────────────────
  const [alertMode, setAlertMode] = useState<AlertMode>("simple");
  const [alertPreset, setAlertPreset] = useState<AlertPreset | null>(null);
  const [alertHtml, setAlertHtml] = useState("");
  const [alertCss, setAlertCss] = useState("");
  const [alertJs, setAlertJs] = useState("");
  const [alertDuration, setAlertDuration] = useState(DEFAULT_ALERT_CONFIG.durationSec);
  const [alertMinAmount, setAlertMinAmount] = useState(DEFAULT_ALERT_CONFIG.minAmountThb);
  const [alertSpawnGap, setAlertSpawnGap] = useState(DEFAULT_ALERT_CONFIG.spawnGapSec);
  const [alertSoundOn, setAlertSoundOn] = useState(true);
  const [alertTtsOn, setAlertTtsOn] = useState(true);
  const [alertSoundVolume, setAlertSoundVolume] = useState(DEFAULT_ALERT_CONFIG.soundVolume);
  const [ttsThresholdThb, setTtsThresholdThb] = useState<number>(ALERT_TTS_THRESHOLD_RANGE.max);
  const [realVoiceOn, setRealVoiceOn] = useState(true);
  const [widgetToken, setWidgetToken] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [alertCodeTab, setAlertCodeTab] = useState<"html" | "css" | "js">("html");
  const [alertPreviewTreatId, setAlertPreviewTreatId] = useState<string | null>(null);
  const [sendingTestAlert, setSendingTestAlert] = useState(false);

  // ── goal bar overlay ─────────────────────────────────────────────────────
  const [jarMode, setJarMode] = useState<JarMode>("simple");
  const [jarPreset, setJarPreset] = useState<JarPreset | null>(null);
  const [jarHtml, setJarHtml] = useState("");
  const [jarCss, setJarCss] = useState("");
  const [jarJs, setJarJs] = useState("");
  const [jarFill, setJarFill] = useState<JarFill>("pink");
  const [jarTexture, setJarTexture] = useState<JarTexture>("stripe");
  const [jarBacking, setJarBacking] = useState<JarBacking>("cream");
  const [jarHeightPx, setJarHeightPx] = useState(DEFAULT_JAR_CONFIG.heightPx);
  const [jarShowName, setJarShowName] = useState(true);
  const [jarShowPct, setJarShowPct] = useState(false);
  const [jarShowAmount, setJarShowAmount] = useState(true);
  const [jarAlign, setJarAlign] = useState<JarAlign>("left");
  const [jarCodeTab, setJarCodeTab] = useState<"html" | "css" | "js">("html");
  const [jarUrlCopied, setJarUrlCopied] = useState(false);
  const [jarPreviewPct, setJarPreviewPct] = useState(50); // example fill for the preview — not the real goal's progress

  // ── privacy ───────────────────────────────────────────────────────────────
  const [privacy, setPrivacy] = useState<PrivacyConfig>(DEFAULT_PRIVACY);
  const [blockDraft, setBlockDraft] = useState("");
  const [allowDraft, setAllowDraft] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [modLog, setModLog] = useState<LogItem[]>([]);
  const [queueBusy, setQueueBusy] = useState<string | null>(null); // payment_intent_id mid-action

  // ── goal ──────────────────────────────────────────────────────────────────
  const [goalLabel, setGoalLabel] = useState("");
  const [goalTarget, setGoalTarget] = useState(0);
  const [goalActive, setGoalActive] = useState(true);
  const [goalDeadline, setGoalDeadline] = useState(""); // "" = no deadline
  const [goalEnding, setGoalEnding] = useState<GoalEnding>("hold");
  const [goalShowOnCounter, setGoalShowOnCounter] = useState(true);
  const [goalShowOnOverlay, setGoalShowOnOverlay] = useState(false);
  const [goalShowOnShare, setGoalShowOnShare] = useState(true);
  const [goalRaised, setGoalRaised] = useState(0); // live, for the panel's own preview only
  const [endingGoal, setEndingGoal] = useState(false);

  // ── menu ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<MenuItem[]>([]);
  const [menuQ, setMenuQ] = useState("");
  const [editing, setEditing] = useState<"new" | MenuItem | null>(null);
  const [formTh, setFormTh] = useState("");
  const [formEn, setFormEn] = useState("");
  const [formPrice, setFormPrice] = useState(0);
  const [formHidden, setFormHidden] = useState(false);
  const [formOrder, setFormOrder] = useState(0);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formThumb, setFormThumb] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerQ, setTagPickerQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuFilter, setMenuFilter] = useState<string>(""); // preview filter chip ("" = everything)
  // drag-and-drop
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<"counter" | "book" | null>(null);

  // ── unsaved-changes tracking ─────────────────────────────────────────────
  // Snapshot of every field the "Save changes" button writes, captured right
  // after load and after each successful save. Diffed against live state on
  // render to drive the nav "unsaved" badges and the leave-page confirm.
  // Defined after the menu state above because it reads `items` for voiceTails.
  function buildSnapshot(): SaveSnapshot {
    return {
      cafe: { name: cafeName, flowerOfMonth: flower, emotionImages, sceneImages },
      voice: { idleLines, pickTemplate, thanksTemplate, currentWeather },
      privacy,
      alerts: { mode: alertMode, preset: alertPreset, html: alertHtml, css: alertCss, js: alertJs, durationSec: alertDuration, minAmountThb: alertMinAmount, spawnGapSec: alertSpawnGap, soundOn: alertSoundOn, ttsOn: alertTtsOn, soundVolume: alertSoundVolume, ttsThresholdThb, realVoiceOn },
      jar: { mode: jarMode, preset: jarPreset, html: jarHtml, css: jarCss, js: jarJs, fill: jarFill, texture: jarTexture, backing: jarBacking, heightPx: jarHeightPx, showName: jarShowName, showPct: jarShowPct, showAmount: jarShowAmount, align: jarAlign },
      goal: { label: goalLabel, targetThb: goalTarget, active: goalActive, deadline: goalDeadline, ending: goalEnding, showOnCounter: goalShowOnCounter, showOnOverlay: goalShowOnOverlay, showOnShare: goalShowOnShare },
      voiceTails: tailsSnapshotOf(items),
    };
  }
  const [savedSnapshot, setSavedSnapshot] = useState<SaveSnapshot | null>(null);
  useEffect(() => {
    if (status === "ready" && savedSnapshot === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedSnapshot(buildSnapshot());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, savedSnapshot]);
  const currentSnapshot = buildSnapshot();
  function panelDirty(key: keyof SaveSnapshot): boolean {
    return !!savedSnapshot && JSON.stringify(currentSnapshot[key]) !== JSON.stringify(savedSnapshot[key]);
  }
  const dirty = (Object.keys(currentSnapshot) as (keyof SaveSnapshot)[]).some(panelDirty);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  function confirmLeaveIfDirty(): boolean {
    return !dirty || window.confirm(L.leaveConfirm);
  }

  const loadAll = useCallback(async () => {
    try {
      const [cfgRes, goalRes, menuRes, privacyRes, queueRes, logRes, publicGoalRes, alertsRes, jarRes] = await Promise.all([
        fetch("/api/cafe-config"),
        fetch("/api/settings/goal"),
        fetch("/api/settings/menu"),
        fetch("/api/settings/privacy"),
        fetch("/api/settings/moderation-queue"),
        fetch("/api/settings/moderation-log"),
        fetch("/api/goal"), // public; only used for this panel's live "raised" preview
        fetch("/api/settings/alerts"),
        fetch("/api/settings/jar"),
      ]);
      if ([goalRes.status, menuRes.status, privacyRes.status, queueRes.status, logRes.status, alertsRes.status, jarRes.status].some((s) => s === 401 || s === 403)) {
        setStatus("unauthorized");
        return;
      }
      if (!cfgRes.ok || !goalRes.ok || !menuRes.ok || !privacyRes.ok || !queueRes.ok || !logRes.ok || !alertsRes.ok || !jarRes.ok) {
        setStatus("error");
        return;
      }
      const cfg = await cfgRes.json();
      if (cfg.config) {
        setCafeName(cfg.config.name);
        setFlower(cfg.config.flowerOfMonth);
        setIdleLines(cfg.config.idleLines ?? []);
        setPickTemplate(cfg.config.pickTemplate ?? PICK_TEMPLATE_DEFAULT);
        setThanksTemplate(cfg.config.thanksTemplate ?? THANKS_TEMPLATE_DEFAULT);
        setCurrentWeather(cfg.config.currentWeather ?? null);
        setEmotionImages(cfg.config.emotionImages ?? EMPTY_EMOTIONS);
        setSceneImages(cfg.config.sceneImages ?? EMPTY_SCENES);
      }
      const g = await goalRes.json();
      const gs: GoalState | null = g.goal ?? null;
      if (gs) {
        setGoalLabel(gs.label);
        setGoalTarget(gs.targetThb);
        setGoalActive(gs.isActive);
        setGoalDeadline(gs.deadline ?? "");
        setGoalEnding(gs.ending ?? "hold");
        setGoalShowOnCounter(gs.showOnCounter ?? true);
        setGoalShowOnOverlay(gs.showOnOverlay ?? false);
        setGoalShowOnShare(gs.showOnShare ?? true);
      }
      if (publicGoalRes.ok) {
        const pg = await publicGoalRes.json();
        setGoalRaised(pg.goal?.raisedThb ?? 0);
      }
      const m = await menuRes.json();
      const loadedItems = (m.items ?? []) as MenuItem[];
      setItems(loadedItems);
      // Server is now canonical for tails — re-baseline the voiceTails slice so a
      // menu-panel save (which reloads here) doesn't leave tails looking unsaved.
      setSavedSnapshot((prev) => (prev ? { ...prev, voiceTails: tailsSnapshotOf(loadedItems) } : prev));
      const p = await privacyRes.json();
      setPrivacy((p.privacy as PrivacyConfig | undefined) ?? DEFAULT_PRIVACY);
      const q = await queueRes.json();
      setQueue((q.queue ?? []) as QueueItem[]);
      const lg = await logRes.json();
      setModLog((lg.log ?? []) as LogItem[]);
      const a = await alertsRes.json();
      const ac: AlertConfig = { ...DEFAULT_ALERT_CONFIG, ...(a.alertConfig as Partial<AlertConfig> | undefined) };
      setAlertMode(ac.mode);
      setAlertPreset(ac.preset);
      setAlertHtml(ac.html);
      setAlertCss(ac.css);
      setAlertJs(ac.js);
      setAlertDuration(ac.durationSec);
      setAlertMinAmount(ac.minAmountThb);
      setAlertSpawnGap(ac.spawnGapSec);
      setAlertSoundOn(ac.soundOn);
      setAlertTtsOn(ac.ttsOn);
      setAlertSoundVolume(ac.soundVolume);
      setTtsThresholdThb((a.ttsThresholdThb as number | undefined) ?? ALERT_TTS_THRESHOLD_RANGE.max);
      setRealVoiceOn((a.realVoiceOn as boolean | undefined) ?? true);
      setWidgetToken((a.widgetToken as string | undefined) ?? "");
      const j = await jarRes.json();
      const jc: JarConfig = { ...DEFAULT_JAR_CONFIG, ...(j.jarConfig as Partial<JarConfig> | undefined) };
      setJarMode(jc.mode);
      setJarPreset(jc.preset);
      setJarHtml(jc.html);
      setJarCss(jc.css);
      setJarJs(jc.js);
      setJarFill(jc.fill);
      setJarTexture(jc.texture);
      setJarBacking(jc.backing);
      setJarHeightPx(jc.heightPx);
      setJarShowName(jc.showName);
      setJarShowPct(jc.showPct);
      setJarShowAmount(jc.showAmount);
      setJarAlign(jc.align);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  // Refresh just the live parts of the Privacy panel (queue + log) after an
  // approve/reject/remember action — cheaper than reloading every tab.
  const reloadQueue = useCallback(async () => {
    try {
      const [queueRes, logRes] = await Promise.all([
        fetch("/api/settings/moderation-queue"),
        fetch("/api/settings/moderation-log"),
      ]);
      if (queueRes.ok) setQueue(((await queueRes.json()).queue ?? []) as QueueItem[]);
      if (logRes.ok) setModLog(((await logRes.json()).log ?? []) as LogItem[]);
    } catch {
      /* leave stale queue/log in place on failure */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll]);

  async function signOut() {
    if (!confirmLeaveIfDirty()) return;
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }

  function resetForm() {
    setTagPickerOpen(false);
    setTagPickerQ("");
  }
  // Global "Save changes" (top-right). Writes the form-backed panels — Café,
  // Voice, and Goal — in one go. The Menu panel persists on every action
  // (per-item save, drag-drop reorder), so it isn't part of this batch. The
  // goal is only written when it has real values, so an empty goal form doesn't
  // fail the whole save.
  async function saveAll() {
    setSavingAll(true);
    try {
      const reqEntries: [keyof SaveSnapshot, Promise<Response>][] = [
        ["cafe", fetch("/api/settings/cafe", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: cafeName, flowerOfMonth: flower, emotionImages, sceneImages }),
        })],
        ["voice", fetch("/api/settings/voice", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idleLines, pickTemplate, thanksTemplate, currentWeather }),
        })],
        ["privacy", fetch("/api/settings/privacy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(privacy),
        })],
        ["alerts", fetch("/api/settings/alerts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: alertMode, preset: alertPreset, html: alertHtml, css: alertCss, js: alertJs,
            durationSec: alertDuration, minAmountThb: alertMinAmount, spawnGapSec: alertSpawnGap,
            soundOn: alertSoundOn, ttsOn: alertTtsOn, soundVolume: alertSoundVolume, ttsThresholdThb, realVoiceOn,
          }),
        })],
        ["jar", fetch("/api/settings/jar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: jarMode, preset: jarPreset, html: jarHtml, css: jarCss, js: jarJs,
            fill: jarFill, texture: jarTexture, backing: jarBacking, heightPx: jarHeightPx,
            showName: jarShowName, showPct: jarShowPct, showAmount: jarShowAmount, align: jarAlign,
          }),
        })],
      ];
      if (goalLabel.trim() && goalTarget > 0) {
        reqEntries.push(["goal", fetch("/api/settings/goal", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: goalLabel, targetThb: goalTarget, currency: "thb", active: goalActive,
            deadline: goalDeadline || null, ending: goalEnding,
            showOnCounter: goalShowOnCounter, showOnOverlay: goalShowOnOverlay, showOnShare: goalShowOnShare,
          }),
        })]);
      }
      // Treat-tails (Voice page) write to their menu-item rows. Only the treats
      // whose tails actually changed since the last save get pushed; the menu
      // PUT is a full-row replace, so each carries the row's current metadata.
      const savedTails = new Map((savedSnapshot?.voiceTails ?? []).map((e) => [e.id, JSON.stringify(e.tails)]));
      const changedTailItems = items.filter((it) => savedTails.get(it.id) !== JSON.stringify(it.tails));
      const tailReqs = changedTailItems.map((it) =>
        fetch(`/api/settings/menu/${it.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ th: it.th, en: it.en, price: it.price_thb, hidden: it.hidden, sortOrder: it.sort_order, tails: it.tails, tags: it.tags, thumbUrl: it.thumb_url }),
        }),
      );

      const [results, tailResults] = await Promise.all([
        Promise.all(reqEntries.map(([, p]) => p)),
        Promise.all(tailReqs),
      ]);
      const tailsOk = tailResults.every((r) => r.ok);
      showFlash(results.every((r) => r.ok) && tailsOk ? L.saved : L.saveFail);
      // Only the panels whose write actually succeeded count as "saved" —
      // an invalid/unset goal (skipped above) must stay flagged unsaved.
      setSavedSnapshot((prev) => {
        if (!prev) return prev;
        const next = { ...prev } as Record<keyof SaveSnapshot, unknown>;
        reqEntries.forEach(([key], i) => {
          if (results[i].ok) next[key] = currentSnapshot[key];
        });
        if (tailsOk) next.voiceTails = currentSnapshot.voiceTails;
        return next as SaveSnapshot;
      });
    } catch {
      showFlash(L.saveFail);
    } finally {
      setSavingAll(false);
    }
  }

  function applyAlertPreset(preset: AlertPreset) {
    const p = ALERT_PRESETS[preset];
    setAlertPreset(preset);
    setAlertHtml(p.html);
    setAlertCss(p.css);
    setAlertJs(p.js);
  }

  function insertAlertToken(token: string) {
    const insert = (s: string) => (s ? `${s}\n${token}` : token);
    if (alertCodeTab === "html") setAlertHtml((s) => insert(s));
    else if (alertCodeTab === "css") setAlertCss((s) => insert(s));
    else setAlertJs((s) => insert(s));
  }

  async function regenerateWidgetToken() {
    if (!window.confirm(L.alertWidgetRegenerateConfirm)) return;
    setRegenerating(true);
    try {
      const res = await fetch("/api/settings/alerts/regenerate-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.widgetToken) {
        showFlash(L.saveFail);
        return;
      }
      setWidgetToken(data.widgetToken);
      showFlash(L.saved);
    } catch {
      showFlash(L.saveFail);
    } finally {
      setRegenerating(false);
    }
  }

  async function copyWidgetUrl() {
    try {
      await navigator.clipboard.writeText(`${origin}/alert?token=${widgetToken}`);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2200);
    } catch {
      /* clipboard permission denied — the field is still selectable by hand */
    }
  }

  async function sendTestAlert() {
    setSendingTestAlert(true);
    try {
      const res = await fetch("/api/admin/test-alert", { method: "POST" });
      showFlash(res.ok ? L.alertTestSent : L.saveFail);
    } catch {
      showFlash(L.saveFail);
    } finally {
      setSendingTestAlert(false);
    }
  }

  // Immediate action, unlike the rest of the goal form — a streamer ending a
  // goal wants it gone from the tip page and overlay right now, not after
  // they remember to hit "Save changes". Writes active:false straight through
  // and reconciles local + saved-snapshot state so the panel doesn't show a
  // stale "unsaved changes" badge afterward.
  async function setGoalActiveNow(nextActive: boolean) {
    if (!goalLabel.trim() || goalTarget <= 0) return;
    setEndingGoal(true);
    try {
      const res = await fetch("/api/settings/goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: goalLabel, targetThb: goalTarget, currency: "thb", active: nextActive,
          deadline: goalDeadline || null, ending: goalEnding,
          showOnCounter: goalShowOnCounter, showOnOverlay: goalShowOnOverlay, showOnShare: goalShowOnShare,
        }),
      });
      if (!res.ok) {
        showFlash(L.saveFail);
        return;
      }
      setGoalActive(nextActive);
      setSavedSnapshot((prev) => (prev ? { ...prev, goal: { ...prev.goal, active: nextActive } } : prev));
      showFlash(L.saved);
    } catch {
      showFlash(L.saveFail);
    } finally {
      setEndingGoal(false);
    }
  }
  function endGoal() {
    if (!goalActive || !goalLabel.trim() || goalTarget <= 0) return;
    if (!window.confirm(L.goalEndConfirm)) return;
    void setGoalActiveNow(false);
  }
  function resumeGoal() {
    if (goalActive) return;
    void setGoalActiveNow(true);
  }

  function applyJarPreset(preset: JarPreset) {
    const p = JAR_PRESETS[preset];
    setJarPreset(preset);
    setJarHtml(p.html);
    setJarCss(p.css);
    setJarJs(p.js);
  }

  function insertJarToken(token: string) {
    const insert = (s: string) => (s ? `${s}\n${token}` : token);
    if (jarCodeTab === "html") setJarHtml((s) => insert(s));
    else if (jarCodeTab === "css") setJarCss((s) => insert(s));
    else setJarJs((s) => insert(s));
  }

  function resetJarStyle() {
    setJarFill(DEFAULT_JAR_CONFIG.fill);
    setJarTexture(DEFAULT_JAR_CONFIG.texture);
    setJarBacking(DEFAULT_JAR_CONFIG.backing);
    setJarAlign(DEFAULT_JAR_CONFIG.align);
    setJarHeightPx(DEFAULT_JAR_CONFIG.heightPx);
  }

  async function copyGoalOverlayUrl() {
    try {
      await navigator.clipboard.writeText(`${origin}/goal-overlay?token=${widgetToken}`);
      setJarUrlCopied(true);
      setTimeout(() => setJarUrlCopied(false), 2200);
    } catch {
      /* clipboard permission denied — the field is still selectable by hand */
    }
  }

  function startNewItem() {
    setEditing("new");
    setFormTh("");
    setFormEn("");
    setFormPrice(0);
    setFormHidden(false);
    setFormOrder(items.length);
    setFormTags([]);
    setFormThumb(null);
    resetForm();
  }
  function startEditItem(item: MenuItem) {
    setEditing(item);
    setFormTh(item.th);
    setFormEn(item.en);
    setFormPrice(item.price_thb);
    setFormHidden(item.hidden);
    setFormOrder(item.sort_order);
    setFormTags(item.tags ?? []);
    setFormThumb(item.thumb_url ?? null);
    resetForm();
  }
  function cancelEditItem() {
    setEditing(null);
  }

  async function submitItem() {
    if (!editing) return;
    setMenuSaving(true);
    // Tails are authored on the Voice page now, not here — pass the row's current
    // tails through unchanged so a metadata edit never wipes them (the menu PUT
    // is a full-row replace).
    const existingTails = editing === "new" ? [] : (items.find((i) => i.id === editing.id)?.tails ?? []);
    const payload = { th: formTh, en: formEn, price: formPrice, hidden: formHidden, sortOrder: formOrder, tails: existingTails, tags: formTags, thumbUrl: formThumb };
    const isNew = editing === "new";
    const url = isNew ? "/api/settings/menu" : `/api/settings/menu/${editing.id}`;
    try {
      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showFlash(L.saveFail);
        return;
      }
      setEditing(null);
      showFlash(L.saved);
      loadAll();
    } catch {
      showFlash(L.saveFail);
    } finally {
      setMenuSaving(false);
    }
  }

  // ── photo upload (editor) ───────────────────────────────────────────────────
  async function uploadThumb(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "menu");
      const res = await fetch("/api/settings/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        showFlash(e.error ?? L.saveFail);
        return;
      }
      const { url } = await res.json();
      setFormThumb(url);
    } catch {
      showFlash(L.saveFail);
    } finally {
      setUploading(false);
    }
  }

  // Shared uploader for the Café panel's Expressions (emotion) and
  // Backgrounds (scene) slots — same route, different folder/target map.
  async function uploadSlot(
    slotKey: string,
    folder: "emote" | "scene",
    file: File,
    apply: (url: string) => void
  ) {
    setSlotUploading(slotKey);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch("/api/settings/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        showFlash(e.error ?? L.saveFail);
        return;
      }
      const { url } = await res.json();
      apply(url);
    } catch {
      showFlash(L.saveFail);
    } finally {
      setSlotUploading(null);
    }
  }

  // ── tag picker (editor) ─────────────────────────────────────────────────────
  function addTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    setFormTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagPickerQ("");
  }
  function removeFormTag(tag: string) {
    setFormTags((prev) => prev.filter((t) => t !== tag));
  }

  // ── drag-and-drop reorder / zone move ───────────────────────────────────────
  async function persistOrder(next: MenuItem[]) {
    setItems(next);
    try {
      const res = await fetch("/api/settings/menu/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: next.map((i) => ({ id: i.id, sortOrder: i.sort_order, hidden: i.hidden })) }),
      });
      if (!res.ok) { showFlash(L.saveFail); loadAll(); }
    } catch {
      showFlash(L.saveFail);
      loadAll();
    }
  }

  // Move dragId into a zone (targetHidden), inserted before beforeId (or appended
  // when beforeId is null). Rebuilds a single global sort_order across
  // shelves-then-book so the tip page's ordering stays correct.
  function moveTreat(id: string, targetHidden: boolean, beforeId: string | null) {
    const dragged = items.find((i) => i.id === id);
    if (!dragged) return;
    const without = items.filter((i) => i.id !== id);
    const shelves = without.filter((i) => !i.hidden);
    const book = without.filter((i) => i.hidden);
    const moved = { ...dragged, hidden: targetHidden };
    const target = targetHidden ? book : shelves;
    let idx = target.length;
    if (beforeId) {
      const bi = target.findIndex((i) => i.id === beforeId);
      if (bi >= 0) idx = bi;
    }
    target.splice(idx, 0, moved);
    const combined = [...shelves, ...book].map((i, n) => ({ ...i, sort_order: n }));
    persistOrder(combined);
  }

  // Keyboard-reachable equivalent of drag-reorder — swaps a treat with its
  // neighbour within the same zone (shelves or book stays untouched by this,
  // only onCardDrop/onZoneDrop above move a treat between zones).
  function moveTreatStep(id: string, direction: -1 | 1) {
    const dragged = items.find((i) => i.id === id);
    if (!dragged) return;
    const zoneIds = items.filter((i) => i.hidden === dragged.hidden).map((i) => i.id);
    const idx = zoneIds.indexOf(id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= zoneIds.length) return;
    const globalIdx = items.findIndex((i) => i.id === id);
    const swapGlobalIdx = items.findIndex((i) => i.id === zoneIds[swapIdx]);
    const reordered = [...items];
    [reordered[globalIdx], reordered[swapGlobalIdx]] = [reordered[swapGlobalIdx], reordered[globalIdx]];
    persistOrder(reordered.map((i, n) => ({ ...i, sort_order: n })));
  }

  function onCardDrop(overId: string, zone: "counter" | "book") {
    if (!dragId) return;
    if (dragId !== overId) moveTreat(dragId, zone === "book", overId);
    setDragId(null);
    setDragOverZone(null);
  }
  function onZoneDrop(zone: "counter" | "book") {
    if (!dragId) return;
    moveTreat(dragId, zone === "book", null);
    setDragId(null);
    setDragOverZone(null);
  }

  async function deleteItem(id: string) {
    if (!window.confirm(L.menuDeleteConfirm)) return;
    try {
      const res = await fetch(`/api/settings/menu/${id}`, { method: "DELETE" });
      if (!res.ok) {
        showFlash(L.saveFail);
        return;
      }
      showFlash(L.deleted);
      loadAll();
    } catch {
      showFlash(L.saveFail);
    }
  }

  // Treat-tails are edited here on the Voice page now (Menu panel dropped its
  // tails editor). These mutate `items` directly; the changes batch behind the
  // global Save via the voiceTails snapshot slice.
  function addTreatTail(itemId: string) {
    setItems((list) => list.map((it) => (it.id === itemId ? { ...it, tails: [...it.tails, { th: "", en: "" }] } : it)));
  }
  function updateTreatTail(itemId: string, i: number, field: "th" | "en", value: string) {
    setItems((list) => list.map((it) => (it.id === itemId ? { ...it, tails: it.tails.map((x, xi) => (xi === i ? { ...x, [field]: value } : x)) } : it)));
  }
  function removeTreatTail(itemId: string, i: number) {
    setItems((list) => list.map((it) => (it.id === itemId ? { ...it, tails: it.tails.filter((_, xi) => xi !== i) } : it)));
  }

  function addIdleLine() {
    const id = `line-${Date.now()}`;
    setIdleLines((t) => [...t, { id, th: "", en: "", tags: [] }]);
    setSelectedLineId(id); // open the new blank line in the detail rail straight away
  }
  function updateIdleLine(id: string, field: "th" | "en", value: string) {
    setIdleLines((t) => t.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  }
  function removeIdleLine(id: string) {
    setIdleLines((t) => t.filter((x) => x.id !== id));
    setSelectedLineId((cur) => (cur === id ? null : cur));
  }
  function addLineTag(id: string, tag: ConditionTag) {
    setIdleLines((t) => t.map((x) => (x.id === id && !x.tags.includes(tag) ? { ...x, tags: [...x.tags, tag] } : x)));
  }
  function removeLineTag(id: string, tag: ConditionTag) {
    setIdleLines((t) => t.map((x) => (x.id === id ? { ...x, tags: x.tags.filter((tg) => tg !== tag) } : x)));
  }
  // Missing-translation nudge: a line with text in one language but not the
  // other. No-default-line warning: nothing left untagged as a fallback.
  const missingTranslationCount = idleLines.filter((l) => (l.th.trim() && !l.en.trim()) || (l.en.trim() && !l.th.trim())).length;
  const noDefaultLine = idleLines.length > 0 && !idleLines.some((l) => l.tags.length === 0);

  // Token insertion for the pick / thanks templates. Each template block owns
  // its own chip row (D2), so a token always targets a known field — no shared
  // palette, no invisible "last focused" tracking.
  const appendToken = (s: string, token: string) => (s ? `${s} ${token}` : token);
  function insertPickToken(field: "th" | "en", token: string) {
    setPickTemplate((t) => ({ ...t, [field]: appendToken(t[field], token) }));
  }
  function insertThanksToken(field: "th" | "en", token: string) {
    setThanksTemplate((t) => ({ ...t, [field]: appendToken(t[field], token) }));
  }

  // ── privacy: word lists ──────────────────────────────────────────────────
  // Same parsing the design uses: JSON array, or split on newline/comma/
  // semicolon/tab — lets a paste of many words work as well as an import file.
  function parseTerms(raw: string): string[] {
    const s = raw.trim();
    if (!s) return [];
    if (s[0] === "[" || s[0] === "{") {
      try {
        const j = JSON.parse(s);
        const arr = Array.isArray(j) ? j : Array.isArray(j.words) ? j.words : Object.values(j);
        return (arr as unknown[]).map((x) => String(x).trim()).filter(Boolean);
      } catch {
        /* fall through to delimiter split */
      }
    }
    return s.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean);
  }
  function addWords(key: "blockWords" | "allowWords", terms: string[]) {
    if (terms.length === 0) return;
    setPrivacy((p) => {
      const seen = new Set(p[key].map((w) => w.toLowerCase()));
      const fresh = terms.filter((t) => !seen.has(t.toLowerCase()));
      return fresh.length ? { ...p, [key]: [...p[key], ...fresh] } : p;
    });
  }
  function removeWord(key: "blockWords" | "allowWords", word: string) {
    setPrivacy((p) => ({ ...p, [key]: p[key].filter((w) => w !== word) }));
  }
  function clearDraft(key: "blockWords" | "allowWords") {
    if (key === "blockWords") setBlockDraft("");
    else setAllowDraft("");
  }
  function submitDraft(key: "blockWords" | "allowWords") {
    addWords(key, parseTerms(key === "blockWords" ? blockDraft : allowDraft));
    clearDraft(key);
  }
  function importWordsFile(key: "blockWords" | "allowWords", file: File) {
    const reader = new FileReader();
    reader.onload = () => addWords(key, parseTerms(String(reader.result ?? "")));
    reader.readAsText(file);
  }

  // ── privacy: moderation queue ────────────────────────────────────────────
  async function queueAction(paymentIntentId: string, action: "approve" | "reject" | "remember") {
    setQueueBusy(paymentIntentId);
    try {
      const res = await fetch(`/api/settings/moderation-queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      if (!res.ok) {
        showFlash(L.saveFail);
        return;
      }
      showFlash(L.saved);
      await reloadQueue();
    } catch {
      showFlash(L.saveFail);
    } finally {
      setQueueBusy(null);
    }
  }

  if (status === "unauthorized") {
    return (
      <div style={rootStyle}>
        <div style={{ ...cardStyle, width: 460, padding: 28, textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: dot, fontSize: 18, color: "#9E4B54" }}>{L.unauthorized}</div>
          <a href="/login" style={{ fontFamily: mono, fontSize: 11, color: "#9E4B54" }}>{L.signIn}</a>
        </div>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <div className="settings-shell" style={{ width: SHELL_WIDTH[tab], maxWidth: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={cardStyle}>
          {/* header */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 14, borderBottom: "3px dashed #DBB79A" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 36, height: 36, background: "#FDD3E0", border: "3px solid #9E4B54", display: "grid", placeItems: "center", fontSize: 16 }}>✿</span>
              <div>
                <div style={{ fontFamily: dot, fontSize: 22, lineHeight: 1.1, color: "#9E4B54" }}>Whispering Rain Café</div>
                <div style={{ fontSize: 12, color: "#A8836F", marginTop: 2 }}>{L.subtitle}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <a href="/dashboard" onClick={(e) => { if (!confirmLeaveIfDirty()) e.preventDefault(); }} style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{L.backDash}</a>
              <span style={{ display: "flex", border: "3px solid #9E4B54" }}>
                {(["th", "en"] as Lang[]).map((l) => (
                  <button key={l} onClick={() => setLang(l)} style={segBtn(lang === l)}>{l.toUpperCase()}</button>
                ))}
              </span>
              <button onClick={signOut} style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "6px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{L.signOut}</button>
              {status === "ready" && (
                <button onClick={saveAll} disabled={savingAll} style={{ border: "none", cursor: savingAll ? "default" : "pointer", background: "#9E4B54", color: "#FFF1E2", padding: "10px 16px", boxShadow: "0 5px 0 #6B2F3A", fontFamily: dot, fontSize: 15, opacity: savingAll ? 0.7 : 1 }}>
                  {savingAll ? L.saving : L.saveChanges}
                </button>
              )}
            </div>
          </div>

          {status === "loading" ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontFamily: dot, fontSize: 16, color: "#A8836F" }}>{L.loading}</div>
          ) : status === "error" ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.error}</div>
          ) : (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {/* left category rail */}
              <nav style={{ flex: "none", width: 214, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".12em", color: "#9A6656", padding: "0 2px 4px" }}>{L.navHint}</span>
                {([["cafe", L.tCafe], ["menu", L.tMenu], ["goal", L.tGoal], ["voice", L.tVoice], ["alerts", L.tAlerts], ["jar", L.tJar], ["privacy", L.tPrivacy]] as [Tab, string][]).map(([t, label]) => {
                  const here = tab === t;
                  // Voice also owns the treat-tails slice, which lives outside the tab-keyed snapshot.
                  const unsaved = !here && t !== "menu" && (panelDirty(t as keyof SaveSnapshot) || (t === "voice" && panelDirty("voiceTails")));
                  const dotColor = here ? "#9E4B54" : unsaved ? "#C9A227" : "#DBB79A";
                  return (
                    <button key={t} onClick={() => setTab(t)} style={navBtn(here)}>
                      <span style={{ flex: "none", width: 9, height: 9, background: dotColor }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                        <span>{label}</span>
                        {(here || unsaved) && (
                          <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: unsaved ? "#9A6656" : "#B07B6A" }}>
                            {here ? L.navHere : L.navUnsaved}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                <div style={{ marginTop: 6, padding: 11, background: "#FFF9EC", border: "3px solid #DBB79A", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".12em", color: "#9A6656" }}>{L.cafeLinkLabel}</span>
                  <a href={origin || "/"} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#7A3F49", wordBreak: "break-all" }}>{origin || "…"}</a>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8E6B5B" }}>
                    <span style={{ width: 7, height: 7, background: "#7FB98B" }} />
                    <span>{L.liveWord}</span>
                  </span>
                </div>
              </nav>

              {/* panel content */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {tab === "cafe" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
                  {/* the basics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                    <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.tCafe}</span>
                    <label style={fieldLabel}>{L.cafeName}</label>
                    <input value={cafeName} onChange={(e) => setCafeName(e.target.value)} maxLength={60} style={inputStyle} />
                    <label style={fieldLabel}>{L.cafeFlower}</label>
                    <input value={flower} onChange={(e) => setFlower(e.target.value)} maxLength={60} style={inputStyle} />
                    <div style={{ fontSize: 11, color: "#B07B6A" }}>{L.cafeFlowerHint}</div>
                  </div>

                  {/* device toggle — shared by Expressions + Backgrounds below */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                    <div style={{ display: "flex" }}>
                      <button onClick={() => setImageDevice("mobile")} style={segBtn(imageDevice === "mobile")}>{L.deviceMobile}</button>
                      <button onClick={() => setImageDevice("desktop")} style={segBtn(imageDevice === "desktop")}>{L.deviceDesktop}</button>
                    </div>
                    <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.deviceNote}</span>
                  </div>

                  {/* expressions */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.expressionsTitle}</span>
                      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{L.expressionsSub}</span>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: "#B07B6A" }}>{L.expressionsNote}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 9 }}>
                      {([
                        ["neutral", L.emoNeutral, L.emoNeutralNote],
                        ["smile", L.emoSmile, L.emoSmileNote],
                        ["sad", L.emoSad, L.emoSadNote],
                        ["sparkle", L.emoSparkle, L.emoSparkleNote],
                      ] as [Emotion, string, string][]).map(([key, label, note]) => {
                        const slotKey = `emo-${imageDevice}-${key}`;
                        const url = emotionImages[imageDevice][key];
                        const apply = (u: string) => setEmotionImages((m) => ({ ...m, [imageDevice]: { ...m[imageDevice], [key]: u } }));
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <label
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadSlot(slotKey, "emote", f, apply); }}
                              style={{ position: "relative", display: "block", width: "100%", aspectRatio: imageDevice === "mobile" ? "1 / 1" : "3 / 4", cursor: "pointer", overflow: "hidden", background: url ? `center / cover no-repeat url("${url}")` : TREAT_DITHER, boxShadow: "inset 0 0 0 2px #DBB79A" }}
                            >
                              {!url && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 6, textAlign: "center", fontSize: 9, fontFamily: mono, color: "#9A6656" }}>{slotUploading === slotKey ? L.uploading : L.slotHint}</span>}
                              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlot(slotKey, "emote", f, apply); e.target.value = ""; }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
                            </label>
                            <span style={{ fontSize: 11.5, color: "#7A3F49" }}>{label}</span>
                            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: "#B07B6A" }}>{note}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* backgrounds */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.backgroundsTitle}</span>
                      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{L.backgroundsSub}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 9 }}>
                      {([
                        ["day", L.sceneDay, L.sceneDayNote],
                        ["dusk", L.sceneDusk, L.sceneDuskNote],
                        ["night", L.sceneNight, L.sceneNightNote],
                      ] as [Scene, string, string][]).map(([key, label, note]) => {
                        const slotKey = `scn-${imageDevice}-${key}`;
                        const url = sceneImages[imageDevice][key];
                        const apply = (u: string) => setSceneImages((m) => ({ ...m, [imageDevice]: { ...m[imageDevice], [key]: u } }));
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <label
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadSlot(slotKey, "scene", f, apply); }}
                              style={{ position: "relative", display: "block", width: "100%", aspectRatio: imageDevice === "mobile" ? "1 / 1" : "4 / 3", cursor: "pointer", overflow: "hidden", background: url ? `center / cover no-repeat url("${url}")` : TREAT_DITHER, boxShadow: "inset 0 0 0 2px #DBB79A" }}
                            >
                              {!url && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 6, textAlign: "center", fontSize: 9, fontFamily: mono, color: "#9A6656" }}>{slotUploading === slotKey ? L.uploading : L.slotHint}</span>}
                              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlot(slotKey, "scene", f, apply); e.target.value = ""; }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
                            </label>
                            <span style={{ fontSize: 11.5, color: "#7A3F49" }}>{label}</span>
                            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: "#B07B6A" }}>{note}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {tab === "goal" && (() => {
                const today = new Date().toISOString().slice(0, 10);
                const pct = goalTarget > 0 ? Math.min(100, Math.round((goalRaised / goalTarget) * 100)) : 0;
                const remaining = Math.max(0, goalTarget - goalRaised);
                const toggleRow = (checked: boolean, label: string, note: string, onClick: () => void) => (
                  <button onClick={onClick} role="checkbox" aria-checked={checked} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: checked ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${checked ? "#9E4B54" : "#DBB79A"}` }}>
                    <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: checked ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{checked ? "✓" : ""}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                      <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                    </span>
                  </button>
                );
                return (
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0, maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* the jar */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.tGoal}</span>
                          {(goalLabel.trim() || goalTarget > 0) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".06em", color: goalActive ? "#3E8E5A" : "#B07B6A" }}>
                                {goalActive ? `● ${L.goalStatusLive}` : `○ ${L.goalStatusEnded}`}
                              </span>
                              {goalActive ? (
                                <button onClick={endGoal} disabled={endingGoal} style={{ ...editBtnStyle, opacity: endingGoal ? 0.6 : 1 }}>
                                  {L.goalEndBtn}
                                </button>
                              ) : (
                                <button onClick={resumeGoal} disabled={endingGoal} style={{ ...editBtnStyle, opacity: endingGoal ? 0.6 : 1 }}>
                                  {L.goalResumeBtn}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {!goalLabel && !goalTarget && <div style={{ fontSize: 12, color: "#A8836F" }}>{L.goalNone}</div>}
                        <label style={fieldLabel}>{L.goalLabel}</label>
                        <input value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)} maxLength={80} style={inputStyle} />
                        <div style={{ display: "flex", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <label style={fieldLabel}>{L.goalTarget}</label>
                            <input type="number" min={20} max={70000} value={goalTarget} onChange={(e) => setGoalTarget(Number(e.target.value))} style={inputStyle} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                              <label style={fieldLabel}>{L.goalDeadlineLabel}</label>
                              {goalDeadline && <button onClick={() => setGoalDeadline("")} style={{ border: "none", background: "none", cursor: "pointer", fontFamily: mono, fontSize: 8, letterSpacing: ".06em", color: "#B07B6A", textDecoration: "underline" }}>{L.goalClear}</button>}
                            </div>
                            <input type="date" className="pixel-date" min={today} value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} style={inputStyle} />
                          </div>
                        </div>
                        <div style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{goalDeadline ? L.goalDeadlineNoteSet(goalDeadline) : L.goalDeadlineNoteEmpty}</div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 10, borderTop: "2px dashed #DBB79A" }}>
                          <span style={fieldLabel}>{L.goalEndingTitle}</span>
                          {([
                            ["raise", L.goalEndRaise, L.goalEndRaiseNote],
                            ["hold", L.goalEndHold, L.goalEndHoldNote],
                            ["hide", L.goalEndHide, L.goalEndHideNote],
                          ] as [GoalEnding, string, string][]).map(([id, label, note]) => (
                            <button key={id} onClick={() => setGoalEnding(id)} role="radio" aria-checked={goalEnding === id} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: goalEnding === id ? "#FDD3E0" : "#FFF1E2", boxShadow: `inset 0 0 0 2px ${goalEnding === id ? "#9E4B54" : "#DBB79A"}` }}>
                              <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: goalEnding === id ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{goalEnding === id ? "●" : ""}</span>
                              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                                <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* where it shows */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.goalShowTitle}</span>
                        {toggleRow(goalShowOnCounter, L.goalOnCounter, L.goalOnCounterNote, () => setGoalShowOnCounter((v) => !v))}
                        {toggleRow(goalShowOnOverlay, L.goalOnOverlay, L.goalOnOverlayNote, () => setGoalShowOnOverlay((v) => !v))}
                        {toggleRow(goalShowOnShare, L.goalOnShare, L.goalOnShareNote, () => setGoalShowOnShare((v) => !v))}
                      </div>
                    </div>

                    {/* right rail */}
                    <div style={{ flex: "none", width: 300, display: "flex", flexDirection: "column", gap: 14 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.goalCounterPreview}</span>
                          <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#B07B6A" }}>LIVE</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, background: "#FDF5E4", boxShadow: "inset 0 0 0 3px #9E4B54" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontFamily: dot, fontSize: 15, color: "#7A3F49", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goalLabel || "—"}</span>
                            <span style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{pct}%</span>
                          </div>
                          <div style={{ height: 14, border: "2px solid #9E4B54", background: "#F1E2C8", padding: 2 }}>
                            <div style={{ height: "100%", background: "repeating-linear-gradient(90deg,#F4A9BD 0 6px,#EE93AB 6px 12px)", width: `${pct}%` }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: mono, fontSize: 9, color: "#8E6B5B" }}>
                            <span>฿{goalRaised.toLocaleString()}</span>
                            <span>฿{goalTarget.toLocaleString()}</span>
                          </div>
                          {goalDeadline && <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#8E6B5B" }}>{L.goalDeadlineNoteSet(goalDeadline)}</div>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.goalRemainingPreview}</span>
                        <span style={{ fontFamily: dot, fontSize: 30, lineHeight: 1, color: "#9E4B54" }}>฿{remaining.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {tab === "voice" && (() => {
                const tagLabel = (tag: ConditionTag): string => {
                  const map: Record<ConditionTag, string> = {
                    morning: L.tagMorning, afternoon: L.tagAfternoon, dusk: L.tagDusk, night: L.tagNight,
                    rain: L.tagRain, clear: L.tagClear, hot: L.tagHot,
                    first: L.tagFirst, returning: L.tagReturning, top: L.tagTop, away: L.tagAway,
                  };
                  return map[tag];
                };
                const tagGroups: [string, ConditionTag[]][] = [
                  [L.voiceGroupTime, TIME_TAGS],
                  [L.voiceGroupWeather, WEATHER_TAGS],
                  [L.voiceGroupGuest, GUEST_TAGS],
                ];

                // Scene simulator — a hypothetical context that lights up the
                // idle line that would win under it, plus pick/thanks renders.
                const simTags = [simTime, simWeather, simGuest].filter((t): t is ConditionTag => !!t);
                const simTreat = items.find((i) => i.id === simTreatId) ?? null;
                const winningLine = idleLines.length > 0 ? pickIdleLine(idleLines, simTags) : null;
                // First tail, not a random one — a preview should stay stable across re-renders.
                const simTail = simTreat && simTreat.tails.length > 0 ? simTreat.tails[0] : null;
                const pickTokens = { item: simTreat ? simTreat[lang] : "", amount: simTreat ? `฿${simTreat.price_thb}` : "", line: simTail ? simTail[lang] : "" };
                const thanksTokens = { name: "Rapunzel", item: simTreat ? simTreat[lang] : "", amount: simTreat ? `฿${simTreat.price_thb}` : "" };

                // Master-list helpers.
                const lineText = (l: IdleLine) => (lang === "th" ? l.th : l.en) || (lang === "th" ? l.en : l.th) || "—";
                const lineMissing = (l: IdleLine) => (l.th.trim() && !l.en.trim()) || (l.en.trim() && !l.th.trim());
                const q = lineQuery.trim().toLowerCase();
                const filteredLines = idleLines.filter(
                  (l) => !q || l.th.toLowerCase().includes(q) || l.en.toLowerCase().includes(q) || l.tags.some((t) => tagLabel(t).toLowerCase().includes(q)),
                );
                const selectedLine = idleLines.find((l) => l.id === selectedLineId) ?? null;

                // Bucket the filtered lines by their exact condition-set (defaults first).
                const buckets = new Map<string, { tags: ConditionTag[]; lines: IdleLine[] }>();
                for (const l of filteredLines) {
                  const key = [...l.tags].sort().join("+");
                  if (!buckets.has(key)) buckets.set(key, { tags: [...l.tags].sort(), lines: [] });
                  buckets.get(key)!.lines.push(l);
                }
                const bucketList = [...buckets.values()].sort((a, b) => a.tags.length - b.tags.length || a.tags.join().localeCompare(b.tags.join()));

                const lineRow = (l: IdleLine) => {
                  const selected = l.id === selectedLineId;
                  const wins = simOpen && winningLine?.id === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelectedLineId(l.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: selected ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${selected ? "#9E4B54" : "#DBB79A"}` }}
                    >
                      <span aria-hidden style={{ flex: "none", width: 7, height: 7, background: lineMissing(l) ? "#C9A227" : "transparent" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#6B4535", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lineText(l)}</span>
                      {l.tags.length === 0 ? (
                        <span style={{ flex: "none", fontFamily: mono, fontSize: 8, letterSpacing: ".06em", color: "#B07B6A" }}>DEFAULT</span>
                      ) : (
                        <span style={{ flex: "none", display: "flex", gap: 3 }}>
                          {l.tags.map((t) => (
                            <span key={t} style={{ padding: "2px 5px", background: "#FDD3E0", boxShadow: "inset 0 0 0 1px #C4818F", fontSize: 9, color: "#7A3F49" }}>{tagLabel(t)}</span>
                          ))}
                        </span>
                      )}
                      {wins && <span style={{ flex: "none", fontFamily: mono, fontSize: 8, letterSpacing: ".04em", color: "#9E4B54" }}>{L.voiceLineWinsBadge}</span>}
                    </button>
                  );
                };

                // Token chip row that inserts into one known field (D2 — no shared
                // palette, no "last focused"). Only the tokens valid for the moment.
                const tokenRow = (tokens: string[], onInsert: (tok: string) => void) => (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {tokens.map((tok) => (
                      <button key={tok} onClick={() => onInsert(tok)} style={{ padding: "4px 7px", border: "none", cursor: "pointer", background: "#EEDCBE", boxShadow: "inset 0 0 0 2px #DBB79A", fontFamily: mono, fontSize: 9, color: "#7A5C4B" }}>{tok}</button>
                    ))}
                  </div>
                );

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* ── LIVE weather strip (E1) — a runtime control, not authoring ── */}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 13px", background: "#FDF5E4", border: "3px solid #9E4B54" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
                        <span aria-hidden style={{ width: 8, height: 8, background: "#C4646F", animation: "pulsedot 1.6s ease-in-out infinite" }} />
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", color: "#9E4B54" }}>LIVE</span>
                      </span>
                      <span style={{ flex: "none", fontFamily: dot, fontSize: 15, color: "#7A3F49" }}>{L.voiceLiveWeather}</span>
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button onClick={() => setCurrentWeather(null)} style={previewChip(currentWeather === null)}>{L.voiceWeatherNone}</button>
                        {WEATHER_TAGS.map((w) => (
                          <button key={w} onClick={() => setCurrentWeather(w)} style={previewChip(currentWeather === w)}>{tagLabel(w)}</button>
                        ))}
                      </span>
                      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.voiceLiveWeatherNote}</span>
                    </div>

                    {/* ── Scene bar (F2) — "Preview as a guest" ── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: simOpen ? 11 : 0, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.voiceSceneTitle}</span>
                          <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#B07B6A" }}>{L.voiceSimTag}</span>
                        </span>
                        <button onClick={() => setSimOpen((v) => !v)} aria-expanded={simOpen} style={{ border: "none", cursor: "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", padding: "6px 10px", fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>{simOpen ? L.voiceSceneClose : L.voiceSceneOpen}</button>
                      </div>
                      {simOpen && (
                        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                            {tagGroups.map(([label, tags]) => {
                              const current = label === L.voiceGroupTime ? simTime : label === L.voiceGroupWeather ? simWeather : simGuest;
                              const setCurrent = label === L.voiceGroupTime ? (v: ConditionTag | null) => setSimTime((v ?? "night") as TimeTag) : label === L.voiceGroupWeather ? (v: ConditionTag | null) => setSimWeather(v as WeatherTag | null) : (v: ConditionTag | null) => setSimGuest(v as GuestTag | null);
                              return (
                                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{label}</span>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {label !== L.voiceGroupTime && (
                                      <button onClick={() => setCurrent(null)} style={previewChip(current === null)}>{L.voiceSimNone}</button>
                                    )}
                                    {tags.map((t) => (
                                      <button key={t} onClick={() => setCurrent(t)} style={previewChip(current === t)}>{tagLabel(t)}</button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{L.voiceSimTreat}</span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                <button onClick={() => setSimTreatId(null)} style={previewChip(simTreatId === null)}>{L.voiceSimNone}</button>
                                {items.map((it) => (
                                  <button key={it.id} onClick={() => setSimTreatId(it.id)} style={previewChip(simTreatId === it.id)}>{it[lang]}</button>
                                ))}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.voiceSceneNote}</span>
                          </div>
                          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9, padding: 12, background: "#FDF5E4", boxShadow: "inset 0 0 0 3px #9E4B54" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{L.voiceSimGreeting}</span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#6B4535", textWrap: "pretty" }}>{winningLine ? winningLine[lang] : "—"}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{L.voiceSimPick}</span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#6B4535", textWrap: "pretty" }}>{renderTemplate(pickTemplate[lang], pickTokens)}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{L.voiceSimThanks}</span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#6B4535", textWrap: "pretty" }}>{renderTemplate(thanksTemplate[lang], thanksTokens)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Two columns: moments (left) + selected-line editor (right) ── */}
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>

                        {/* Moment 1 — while they browse (master list) */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.voiceMomentBrowse}</span>
                            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".08em", color: "#B07B6A" }}>{L.voiceMomentBrowseSub}</span>
                          </div>
                          {missingTranslationCount > 0 && (
                            <div style={{ padding: "8px 10px", background: "#FBF0CF", boxShadow: "inset 0 0 0 2px #C9A227", fontSize: 11.5, color: "#7A5C1E" }}>{L.voiceMissing(missingTranslationCount)}</div>
                          )}
                          {noDefaultLine && (
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 11px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54" }}>
                              <span aria-hidden style={{ flex: "none", width: 8, height: 8, marginTop: 5, background: "#9E4B54" }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.55, color: "#6B2F3A" }}>{L.voiceNoDefault}</span>
                            </div>
                          )}
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            <input value={lineQuery} onChange={(e) => setLineQuery(e.target.value)} placeholder={L.voiceLineSearch} style={{ ...inputStyle, flex: "1 1 160px", minWidth: 0 }} />
                            <button onClick={() => setGroupByCondition((v) => !v)} role="checkbox" aria-checked={groupByCondition} style={{ display: "flex", alignItems: "center", gap: 6, flex: "none", border: "none", cursor: "pointer", background: groupByCondition ? "#FDD3E0" : "#FFF1E2", boxShadow: `inset 0 0 0 2px ${groupByCondition ? "#9E4B54" : "#DBB79A"}`, padding: "7px 10px", fontSize: 11, color: "#7A3F49" }}>
                              <span aria-hidden style={{ width: 12, height: 12, display: "grid", placeItems: "center", background: groupByCondition ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 8, lineHeight: 1, color: "#FFF1E2" }}>{groupByCondition ? "✓" : ""}</span>
                              {L.voiceGroupToggle}
                            </button>
                            <span style={{ flex: "none", fontFamily: mono, fontSize: 9, color: "#B07B6A" }}>{L.voiceLineCount(idleLines.length)}</span>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 440, overflowY: "auto" }}>
                            {idleLines.length === 0 ? (
                              <span style={{ padding: 14, textAlign: "center", fontSize: 12, lineHeight: 1.55, color: "#B07B6A" }}>{L.voiceListEmpty}</span>
                            ) : filteredLines.length === 0 ? (
                              <span style={{ padding: 14, textAlign: "center", fontSize: 12, lineHeight: 1.55, color: "#B07B6A" }}>{L.voiceNoMatch}</span>
                            ) : groupByCondition ? (
                              bucketList.map((b) => (
                                <div key={b.tags.join("+") || "__default"} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                  <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656", padding: "4px 2px 0" }}>{b.tags.length === 0 ? L.voiceBucketDefault : b.tags.map(tagLabel).join(" + ")}</span>
                                  {b.lines.map(lineRow)}
                                </div>
                              ))
                            ) : (
                              filteredLines.map(lineRow)
                            )}
                          </div>
                          <button onClick={addIdleLine} style={addBtnStyle}>{L.voiceAddLine}</button>
                        </div>

                        {/* Moment 2 — when they pick a treat (wrapper + per-treat tails) */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.voiceMomentPick}</span>
                            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".08em", color: "#B07B6A" }}>{L.voiceMomentPickSub}</span>
                          </div>

                          {/* wrapper template */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 11, background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                            <span style={fieldLabel}>{L.voicePickLabel}</span>
                            <textarea value={pickTemplate.th} onChange={(e) => setPickTemplate((t) => ({ ...t, th: e.target.value }))} rows={2} placeholder={L.voiceDetailTh} style={{ ...inputStyle, resize: "vertical" }} />
                            {tokenRow(["{{item}}", "{{amount}}", "{{line}}"], (tok) => insertPickToken("th", tok))}
                            <textarea value={pickTemplate.en} onChange={(e) => setPickTemplate((t) => ({ ...t, en: e.target.value }))} rows={2} placeholder={L.voiceDetailEn} style={{ ...inputStyle, resize: "vertical" }} />
                            {tokenRow(["{{item}}", "{{amount}}", "{{line}}"], (tok) => insertPickToken("en", tok))}
                            <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.voicePickNote}</span>
                          </div>

                          {/* per-treat tail lines */}
                          {items.map((it) => (
                            <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 11, background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontFamily: dot, fontSize: 15, color: it.hidden ? "#A8836F" : "#7A3F49" }}>{it[lang] || it.th || it.en}</span>
                                <span style={{ fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>฿{it.price_thb}</span>
                              </div>
                              {it.tails.length === 0 ? (
                                <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.voiceTreatEmpty}</span>
                              ) : (
                                it.tails.map((t, i) => (
                                  <div key={i} style={{ display: "flex", gap: 8 }}>
                                    <input value={t.th} onChange={(e) => updateTreatTail(it.id, i, "th", e.target.value)} maxLength={200} placeholder={L.voiceDetailTh} style={inputStyle} />
                                    <input value={t.en} onChange={(e) => updateTreatTail(it.id, i, "en", e.target.value)} maxLength={200} placeholder={L.voiceDetailEn} style={inputStyle} />
                                    <button onClick={() => removeTreatTail(it.id, i)} aria-label={`${L.voiceRemove}: ${it[lang]}`} style={dangerBtnStyle}>{L.voiceRemove}</button>
                                  </div>
                                ))
                              )}
                              <button onClick={() => addTreatTail(it.id)} style={addBtnStyle}>{L.voiceTreatAddLine}</button>
                            </div>
                          ))}
                        </div>

                        {/* Moment 3 — after they tip (thanks template) */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.voiceMomentTip}</span>
                            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".08em", color: "#B07B6A" }}>{L.voiceMomentTipSub}</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 11, background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                            <span style={fieldLabel}>{L.voiceThanksLabel}</span>
                            <textarea value={thanksTemplate.th} onChange={(e) => setThanksTemplate((t) => ({ ...t, th: e.target.value }))} rows={2} placeholder={L.voiceDetailTh} style={{ ...inputStyle, resize: "vertical" }} />
                            {tokenRow(["{{name}}", "{{item}}", "{{amount}}"], (tok) => insertThanksToken("th", tok))}
                            <textarea value={thanksTemplate.en} onChange={(e) => setThanksTemplate((t) => ({ ...t, en: e.target.value }))} rows={2} placeholder={L.voiceDetailEn} style={{ ...inputStyle, resize: "vertical" }} />
                            {tokenRow(["{{name}}", "{{item}}", "{{amount}}"], (tok) => insertThanksToken("en", tok))}
                            <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.voiceThanksNote}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right rail — detail editor for the selected idle line (B2) */}
                      <div style={{ flex: "none", width: 320, position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        {selectedLine ? (
                          <>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.voiceDetailTh} · {L.voiceDetailEn}</span>
                              <button onClick={() => removeIdleLine(selectedLine.id)} style={dangerBtnStyle}>{L.voiceRemove}</button>
                            </div>
                            <textarea value={selectedLine.th} onChange={(e) => updateIdleLine(selectedLine.id, "th", e.target.value)} maxLength={300} rows={3} placeholder={L.voiceDetailTh} style={{ ...inputStyle, resize: "vertical" }} />
                            <textarea value={selectedLine.en} onChange={(e) => updateIdleLine(selectedLine.id, "en", e.target.value)} maxLength={300} rows={3} placeholder={L.voiceDetailEn} style={{ ...inputStyle, resize: "vertical" }} />

                            <span style={fieldLabel}>{selectedLine.tags.length === 0 ? L.voiceLineFiresAny : L.voiceLineFiresWhen}</span>
                            {selectedLine.tags.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {selectedLine.tags.map((tag) => (
                                  <span key={tag} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 6px 5px 8px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 11, color: "#7A3F49" }}>
                                    {tagLabel(tag)}
                                    <button onClick={() => removeLineTag(selectedLine.id, tag)} aria-label={`${L.voiceRemove}: ${tagLabel(tag)}`} style={{ width: 14, height: 14, display: "grid", placeItems: "center", border: "none", cursor: "pointer", background: "#9E4B54", fontSize: 8, color: "#FFF1E2" }}>✕</button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "9px 10px", background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                              {tagGroups.map(([label, tags]) => {
                                const addable = tags.filter((t) => !selectedLine.tags.includes(t));
                                if (addable.length === 0) return null;
                                return (
                                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{label}</span>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                      {addable.map((t) => (
                                        <button key={t} onClick={() => addLineTag(selectedLine.id, t)} style={{ padding: "5px 8px", border: "none", cursor: "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 11, color: "#8E6B5B" }}>+ {tagLabel(t)}</button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: 11, background: "#FDF5E4", boxShadow: "inset 0 0 0 3px #9E4B54" }}>
                              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#9A6656" }}>{L.voiceLinePreviewLabel}</span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "#6B4535", textWrap: "pretty" }}>{lineText(selectedLine)}</span>
                            </div>
                          </>
                        ) : (
                          <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, lineHeight: 1.6, color: "#B07B6A" }}>{L.voicePickOne}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {tab === "alerts" && (() => {
                const sliderRow = (
                  label: string,
                  value: number,
                  range: { min: number; max: number; step: number },
                  onChange: (v: number) => void,
                  fmt: (v: number) => string,
                  note: string
                ) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                      <span style={fieldLabel}>{label}</span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{fmt(value)}</span>
                    </div>
                    <input type="range" className="pixel-range" min={range.min} max={range.max} step={range.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
                    <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{note}</span>
                  </div>
                );
                const toggleRow = (checked: boolean, label: string, note: string, onClick: () => void) => (
                  <button key={label} onClick={onClick} role="checkbox" aria-checked={checked} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: checked ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${checked ? "#9E4B54" : "#DBB79A"}` }}>
                    <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: checked ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{checked ? "✓" : ""}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                      <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                    </span>
                  </button>
                );

                const previewItem = items.find((i) => i.id === alertPreviewTreatId) ?? null;
                const previewTokens = {
                  name: "Ployyy",
                  item: previewItem ? previewItem[lang] : lang === "th" ? "มัทฉะลาเต้" : "Matcha latte",
                  amount: previewItem ? `฿${previewItem.price_thb}` : "฿100",
                  message: lang === "th" ? "สู้ๆนะคะ เป็นกำลังใจให้เสมอ!" : "take a proper break tonight, okay? ♡",
                  photo: previewItem?.thumb_url ?? "",
                };
                const previewHtml = renderAlertTemplate(alertHtml, previewTokens);
                const previewCss = renderAlertTemplate(alertCss, previewTokens);
                const previewData = { ...previewTokens, pctNum: 42 };
                const previewBoot = `<script>window.addEventListener('load',function(){try{var el=document.body.firstElementChild;var data=${JSON.stringify(previewData)};${alertJs}}catch(e){}});<\/script>`;
                const previewSrcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${previewCss}</style></head><body>${previewHtml}${previewBoot}</body></html>`;

                return (
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* preview */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.alertsPreviewTitle}</span>
                          <div style={{ display: "flex" }}>
                            <button onClick={() => setAlertMode("simple")} style={segBtn(alertMode !== "code")}>{L.alertModeSimple}</button>
                            <button onClick={() => setAlertMode("code")} style={segBtn(alertMode === "code")}>{L.alertModeCode}</button>
                          </div>
                        </div>
                        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#2A1218", overflow: "hidden" }}>
                          {alertMode === "code" ? (
                            <iframe
                              srcDoc={previewSrcDoc}
                              sandbox="allow-scripts"
                              title="alert preview"
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
                            />
                          ) : widgetToken ? (
                            // The real /alert page, embedded live — it subscribes to the
                            // same realtime channel as any OBS source using this token, so
                            // "Test alert" below shows up here too, not only in OBS.
                            <iframe
                              src={`/alert?token=${encodeURIComponent(widgetToken)}`}
                              title="alert preview live"
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
                            />
                          ) : (
                            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: mono, fontSize: 10, color: "rgba(255,255,255,.55)", textAlign: "center", padding: 16 }}>
                              {L.alertModeSimple} · {origin}/alert
                            </div>
                          )}
                        </div>
                        {alertMode === "code" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <span style={fieldLabel}>{L.alertPreviewTreat}</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button onClick={() => setAlertPreviewTreatId(null)} style={previewChip(alertPreviewTreatId === null)}>{L.voiceSimNone}</button>
                              {items.map((it) => (
                                <button key={it.id} onClick={() => setAlertPreviewTreatId(it.id)} style={previewChip(alertPreviewTreatId === it.id)}>{it[lang]}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* alert behaviour */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.alertBehaviorTitle}</span>
                        {sliderRow(L.alertDuration, alertDuration, ALERT_DURATION_RANGE, setAlertDuration, (v) => `${v}s`, L.alertDurationNote)}
                        {sliderRow(L.alertMinAmount, alertMinAmount, ALERT_MIN_AMOUNT_RANGE, setAlertMinAmount, (v) => (v === 0 ? L.alertMinAmountEvery : `฿${v}`), L.alertMinAmountNote)}
                        {sliderRow(L.alertSpawnGap, alertSpawnGap, ALERT_SPAWN_GAP_RANGE, setAlertSpawnGap, (v) => `${v}s`, L.alertSpawnGapNote)}
                        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 10, borderTop: "2px dashed #DBB79A" }}>
                          {toggleRow(alertTtsOn, L.alertTtsLabel, L.alertTtsNote, () => setAlertTtsOn((v) => !v))}
                          {toggleRow(alertSoundOn, L.alertSoundLabel, L.alertSoundNote, () => setAlertSoundOn((v) => !v))}
                          {sliderRow(L.alertVolume, alertSoundVolume, ALERT_VOLUME_RANGE, setAlertSoundVolume, (v) => `${v}%`, L.alertVolumeNote)}
                        </div>
                      </div>

                      {/* Naire's real voice — a separate promise from the Google-TTS
                          synthesized read-aloud above; conflating the two was a bug. */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.alertRealVoiceTitle}</span>
                        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "#8E6B5B" }}>{L.alertRealVoiceNote}</span>
                        {toggleRow(realVoiceOn, L.alertRealVoiceLabel, L.alertRealVoiceOffNote, () => setRealVoiceOn((v) => !v))}
                        <div style={{ opacity: realVoiceOn ? 1 : 0.45, pointerEvents: realVoiceOn ? "auto" : "none" }}>
                          {sliderRow(L.alertTtsThreshold, ttsThresholdThb, ALERT_TTS_THRESHOLD_RANGE, setTtsThresholdThb, (v) => `฿${v}`, L.alertTtsThresholdNote)}
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* widget */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.alertWidgetTitle}</span>
                        <label style={fieldLabel}>{L.alertWidgetUrlLabel}</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input readOnly value={widgetToken ? `${origin}/alert?token=${widgetToken}` : ""} onFocus={(e) => e.target.select()} style={{ ...inputStyle, fontFamily: mono, fontSize: 11 }} />
                          <button onClick={copyWidgetUrl} style={editBtnStyle}>{urlCopied ? L.alertWidgetCopied : L.alertWidgetCopy}</button>
                        </div>
                        <button onClick={regenerateWidgetToken} disabled={regenerating} style={{ ...dangerBtnStyle, alignSelf: "flex-start", opacity: regenerating ? 0.6 : 1 }}>{L.alertWidgetRegenerate}</button>
                        <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.alertWidgetRegenerateNote}</span>
                        <button onClick={sendTestAlert} disabled={sendingTestAlert} style={{ ...saveBtnStyle, opacity: sendingTestAlert ? 0.6 : 1 }}>{L.alertTestBtn}</button>
                      </div>

                      {/* alert code */}
                      {alertMode === "code" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.alertCodeTitle}</span>
                          <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "#8E6B5B" }}>{L.alertCodeNote}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {(["polaroid", "receipt", "bubble"] as AlertPreset[]).map((p) => (
                              <button key={p} onClick={() => applyAlertPreset(p)} style={previewChip(alertPreset === p)}>
                                {p === "polaroid" ? L.alertPresetPolaroid : p === "receipt" ? L.alertPresetReceipt : L.alertPresetBubble}
                              </button>
                            ))}
                            {alertPreset && <button onClick={() => applyAlertPreset(alertPreset)} style={editBtnStyle}>{L.alertResetCode}</button>}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {["{{name}}", "{{item}}", "{{amount}}", "{{message}}", "{{photo}}"].map((tok) => (
                              <button key={tok} onClick={() => insertAlertToken(tok)} style={editBtnStyle}>{tok}</button>
                            ))}
                          </div>
                          <div style={{ display: "flex" }}>
                            {(["html", "css", "js"] as const).map((t) => (
                              <button key={t} onClick={() => setAlertCodeTab(t)} style={segBtn(alertCodeTab === t)}>{t.toUpperCase()}</button>
                            ))}
                          </div>
                          <textarea
                            value={alertCodeTab === "html" ? alertHtml : alertCodeTab === "css" ? alertCss : alertJs}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (alertCodeTab === "html") setAlertHtml(v);
                              else if (alertCodeTab === "css") setAlertCss(v);
                              else setAlertJs(v);
                            }}
                            spellCheck={false}
                            rows={12}
                            style={{ ...inputStyle, fontFamily: mono, fontSize: 10.5, lineHeight: 1.7, resize: "vertical" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {tab === "jar" && (() => {
                // The preview is a deliberate example, not a mirror of the real
                // current goal — the whole point is checking what 0%/50%/100%
                // etc. look like without waiting for real tips to move the bar.
                const previewTarget = goalTarget > 0 ? goalTarget : 3000;
                const previewRaised = Math.round((previewTarget * jarPreviewPct) / 100);
                const jarTokens = {
                  goalName: goalLabel || (lang === "th" ? "ตัวอย่างเป้าหมาย" : "Example goal"),
                  raised: `฿${previewRaised.toLocaleString()}`,
                  target: `฿${previewTarget.toLocaleString()}`,
                  goalPct: `${jarPreviewPct}%`,
                };
                const jarPreviewHtml = renderHtmlTemplate(jarHtml, jarTokens);
                const jarPreviewCss = renderHtmlTemplate(jarCss, jarTokens);
                const jarPreviewData = { ...jarTokens, pctNum: jarPreviewPct };
                const jarPreviewBoot = `<script>window.addEventListener('load',function(){try{var el=document.body.firstElementChild;var data=${JSON.stringify(jarPreviewData)};${jarJs}}catch(e){}});<\/script>`;
                const jarPreviewSrcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${jarPreviewCss}</style></head><body>${jarPreviewHtml}${jarPreviewBoot}</body></html>`;

                const fillSwatch = (f: JarFill) => jarFillCss(f, "stripe");
                const jarBackingStyle = jarBackingCss(jarBacking);
                const jarFillStyle = jarFillCss(jarFill, jarTexture);
                const jarJustify = jarAlign === "left" ? "flex-start" : jarAlign === "right" ? "flex-end" : "center";
                const realGoalPctNum = goalTarget > 0 ? Math.min(100, Math.round((goalRaised / goalTarget) * 100)) : 0;

                return (
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* preview — an example, driven by the % control below, not the live goal */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.jarPreviewTitle}</span>
                          <div style={{ display: "flex" }}>
                            <button onClick={() => setJarMode("simple")} style={segBtn(jarMode !== "code")}>{L.alertModeSimple}</button>
                            <button onClick={() => setJarMode("code")} style={segBtn(jarMode === "code")}>{L.alertModeCode}</button>
                          </div>
                        </div>
                        <div style={{ position: "relative", width: "100%", aspectRatio: "600 / 90", background: "#2A1218", overflow: "hidden" }}>
                          {jarMode === "code" ? (
                            <iframe
                              srcDoc={jarPreviewSrcDoc}
                              sandbox="allow-scripts"
                              title="goal bar preview"
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
                            />
                          ) : (
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: jarJustify === "flex-start" ? "flex-start" : jarJustify === "flex-end" ? "flex-end" : "center", padding: "0 18px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", maxWidth: 420 }}>
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: jarJustify, gap: 10 }}>
                                  {jarShowName && <span style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "#FFF6EA", textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{jarTokens.goalName}</span>}
                                  {jarShowPct && <span style={{ fontFamily: "var(--font-display)", fontSize: 12, color: "#FFF6EA", textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{jarTokens.goalPct}</span>}
                                  {jarShowAmount && <span style={{ fontFamily: "var(--font-display)", fontSize: 12, color: "#FFF6EA", textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{jarTokens.raised} / {jarTokens.target}</span>}
                                </div>
                                <div style={{ height: jarHeightPx, background: jarBackingStyle.background, boxShadow: jarBackingStyle.boxShadow, padding: 3 }}>
                                  <div style={{ height: "100%", background: jarFillStyle, width: jarTokens.goalPct, transition: "width .3s" }} />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* example % control */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                            <span style={fieldLabel}>{L.jarPreviewPctLabel}</span>
                            <span style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{jarPreviewPct}%</span>
                          </div>
                          <input type="range" className="pixel-range" min={0} max={100} step={1} value={jarPreviewPct} onChange={(e) => setJarPreviewPct(Number(e.target.value))} />
                          <div style={{ display: "flex", gap: 6 }}>
                            {[0, 25, 50, 75, 100].map((p) => (
                              <button key={p} onClick={() => setJarPreviewPct(p)} style={segBtn(jarPreviewPct === p)}>{p}%</button>
                            ))}
                          </div>
                        </div>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8E6B5B" }}>
                          <span style={{ flex: "none", width: 9, height: 9, background: "#DBB79A" }} />
                          <span>{L.jarRedrawNote}</span>
                        </span>
                      </div>

                      {/* style (SIMPLE) or code (CODE) — same slot either way, so
                          switching modes never jumps to a different column */}
                      {jarMode === "simple" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.jarStyleTitle}</span>
                            <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.jarStyleNote}</span>
                          </span>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={fieldLabel}>{L.jarFillLabel}</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {(["pink", "matcha", "lavender", "amber"] as JarFill[]).map((f) => (
                                <button key={f} onClick={() => setJarFill(f)} title={f} style={{ width: 38, height: 30, border: "none", cursor: "pointer", background: fillSwatch(f), boxShadow: `inset 0 0 0 3px ${jarFill === f ? "#9E4B54" : "#DBB79A"}` }} />
                              ))}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={fieldLabel}>{L.jarTextureLabel}</span>
                            <div style={{ display: "flex" }}>
                              <button onClick={() => setJarTexture("stripe")} style={segBtn(jarTexture === "stripe")}>{L.jarTexStripe}</button>
                              <button onClick={() => setJarTexture("solid")} style={segBtn(jarTexture === "solid")}>{L.jarTexSolid}</button>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={fieldLabel}>{L.jarBackingLabel}</span>
                            <div style={{ display: "flex" }}>
                              {(["cream", "dark", "outline"] as JarBacking[]).map((bk) => (
                                <button key={bk} onClick={() => setJarBacking(bk)} style={segBtn(jarBacking === bk)}>
                                  {bk === "cream" ? L.jarBackCream : bk === "dark" ? L.jarBackDark : L.jarBackOutline}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                              <span style={fieldLabel}>{L.jarHeightLabel}</span>
                              <span style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{jarHeightPx}px</span>
                            </div>
                            <input type="range" className="pixel-range" min={JAR_HEIGHT_RANGE.min} max={JAR_HEIGHT_RANGE.max} step={JAR_HEIGHT_RANGE.step} value={jarHeightPx} onChange={(e) => setJarHeightPx(Number(e.target.value))} />
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={fieldLabel}>{L.jarLabelRowTitle}</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {([
                                [jarShowName, L.jarLabelName, () => setJarShowName((v) => !v)],
                                [jarShowPct, L.jarLabelPct, () => setJarShowPct((v) => !v)],
                                [jarShowAmount, L.jarLabelAmount, () => setJarShowAmount((v) => !v)],
                              ] as [boolean, string, () => void][]).map(([checked, label, flip]) => (
                                <button key={label} onClick={flip} role="checkbox" aria-checked={checked} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", border: "none", cursor: "pointer", background: checked ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${checked ? "#9E4B54" : "#DBB79A"}`, fontSize: 12, color: "#7A3F49" }}>
                                  <span style={{ flex: "none", width: 13, height: 13, display: "grid", placeItems: "center", background: checked ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 8, lineHeight: 1, color: "#FFF1E2" }}>{checked ? "✓" : ""}</span>
                                  <span>{label}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 9, borderTop: "2px dashed #DBB79A" }}>
                            <span style={fieldLabel}>{L.jarAlignLabel}</span>
                            <div style={{ display: "flex" }}>
                              {(["left", "center", "right"] as JarAlign[]).map((al) => (
                                <button key={al} onClick={() => setJarAlign(al)} style={segBtn(jarAlign === al)}>
                                  {al === "left" ? L.jarAlignLeft : al === "center" ? L.jarAlignCenter : L.jarAlignRight}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button onClick={resetJarStyle} style={editBtnStyle}>{L.jarResetStyle}</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                          <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.jarCodeTitle}</span>
                          <span style={{ fontSize: 11.5, lineHeight: 1.45, color: "#8E6B5B" }}>{L.jarCodeNote}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {(["boba", "shelf", "minimal"] as JarPreset[]).map((p) => (
                              <button key={p} onClick={() => applyJarPreset(p)} style={previewChip(jarPreset === p)}>
                                {p === "boba" ? L.jarPresetBoba : p === "shelf" ? L.jarPresetShelf : L.jarPresetMinimal}
                              </button>
                            ))}
                            {jarPreset && <button onClick={() => applyJarPreset(jarPreset)} style={editBtnStyle}>{L.alertResetCode}</button>}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {["{{goalName}}", "{{raised}}", "{{target}}", "{{goalPct}}"].map((tok) => (
                              <button key={tok} onClick={() => insertJarToken(tok)} style={editBtnStyle}>{tok}</button>
                            ))}
                          </div>
                          <div style={{ display: "flex" }}>
                            {(["html", "css", "js"] as const).map((t) => (
                              <button key={t} onClick={() => setJarCodeTab(t)} style={segBtn(jarCodeTab === t)}>{t.toUpperCase()}</button>
                            ))}
                          </div>
                          <textarea
                            value={jarCodeTab === "html" ? jarHtml : jarCodeTab === "css" ? jarCss : jarJs}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (jarCodeTab === "html") setJarHtml(v);
                              else if (jarCodeTab === "css") setJarCss(v);
                              else setJarJs(v);
                            }}
                            spellCheck={false}
                            rows={12}
                            style={{ ...inputStyle, fontFamily: mono, fontSize: 10.5, lineHeight: 1.7, resize: "vertical" }}
                          />
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* widget — always visible, mode-independent */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.jarWidgetTitle}</span>
                        <label style={fieldLabel}>{L.alertWidgetUrlLabel}</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input readOnly value={widgetToken ? `${origin}/goal-overlay?token=${widgetToken}` : ""} onFocus={(e) => e.target.select()} style={{ ...inputStyle, fontFamily: mono, fontSize: 11 }} />
                          <button onClick={copyGoalOverlayUrl} style={editBtnStyle}>{jarUrlCopied ? L.alertWidgetCopied : L.alertWidgetCopy}</button>
                        </div>
                        <button onClick={regenerateWidgetToken} disabled={regenerating} style={{ ...dangerBtnStyle, alignSelf: "flex-start", opacity: regenerating ? 0.6 : 1 }}>{L.alertWidgetRegenerate}</button>
                        <span style={{ fontSize: 11, lineHeight: 1.45, color: "#B07B6A" }}>{L.jarWidgetNote}</span>
                      </div>

                      {/* live goal summary — always visible, mode-independent */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                        {goalLabel && goalTarget > 0 ? (
                          <>
                            <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{goalLabel}</span>
                            <span style={{ fontFamily: dot, fontSize: 30, lineHeight: 1, color: "#9E4B54" }}>{realGoalPctNum}%</span>
                            <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: mono, fontSize: 9, color: "#8E6B5B" }}>
                              <span>{L.jarSummaryRaised}: ฿{goalRaised.toLocaleString()}</span>
                              <span>{L.jarSummaryTarget}: ฿{goalTarget.toLocaleString()}</span>
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: "#B07B6A" }}>{L.jarNoGoal}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {tab === "menu" && (() => {
                /* eslint-disable react-hooks/refs -- drag handlers below only run
                   on drop (event time), never during render; the rule mis-reads
                   the onDrop closures calling onCardDrop/onZoneDrop as ref reads. */
                const q = menuQ.trim().toLowerCase();
                const matches = (i: MenuItem) => !q || i.en.toLowerCase().includes(q) || i.th.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q));
                const shelves = items.filter((i) => !i.hidden && matches(i));
                const book = items.filter((i) => i.hidden && matches(i));
                const allTags: string[] = [];
                for (const i of items) for (const t of i.tags) if (!allTags.includes(t)) allTags.push(t);
                const previewShelves = items.filter((i) => !i.hidden && (!menuFilter || i.tags.includes(menuFilter)));
                const pickerBase = Array.from(new Set([...SUGGESTED_TAGS, ...allTags]));
                const pq = tagPickerQ.trim().toLowerCase();
                const pickerOptions = pickerBase.filter((t) => !formTags.includes(t) && (!pq || t.includes(pq)));
                const canCreate = !!pq && !pickerBase.includes(pq) && !formTags.includes(pq);
                const nameOf = (i: MenuItem) => (lang === "th" ? i.th : i.en);

                const renderCard = (item: MenuItem, zone: "counter" | "book", canMoveUp: boolean, canMoveDown: boolean) => {
                  const isEditing = editing !== "new" && editing?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDragId(item.id)}
                      onDragEnd={() => { setDragId(null); setDragOverZone(null); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onCardDrop(item.id, zone); }}
                      style={{ display: "flex", flexDirection: "column", cursor: "grab", background: "#FFFBF2", boxShadow: `inset 0 0 0 2px ${isEditing ? "#9E4B54" : "#DBB79A"}`, opacity: dragId === item.id ? 0.4 : 1 }}
                    >
                      <button
                        onClick={() => startEditItem(item)}
                        style={{ display: "flex", flexDirection: "column", width: "100%", padding: 0, border: "none", cursor: "inherit", textAlign: "left", background: "none" }}
                      >
                        <span style={{ display: "block", width: "100%", aspectRatio: "1 / 1", background: cardThumbBg(item.thumb_url) }} aria-hidden />
                        <span style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 9px 9px" }}>
                          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                            <span style={{ minWidth: 0, fontFamily: dot, fontSize: 13, color: zone === "book" ? "#8E6B5B" : "#7A3F49", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(item)}</span>
                            <span style={{ flex: "none", fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>฿{item.price_thb}</span>
                          </span>
                          <span style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                            {item.tags.slice(0, 3).map((t) => (
                              <span key={t} style={{ padding: "3px 6px", background: zone === "book" ? "#EEDCBE" : "#FDD3E0", boxShadow: `inset 0 0 0 1px ${zone === "book" ? "#DBB79A" : "#C4818F"}`, fontSize: 10, color: "#7A3F49" }}>{t}</span>
                            ))}
                            {item.tags.length === 0 && <span style={{ fontSize: 10, color: "#C09A86" }}>—</span>}
                          </span>
                        </span>
                      </button>
                      {/* Keyboard/screen-reader alternative to drag-to-reorder (WCAG 2.5.7). */}
                      <span style={{ display: "flex", borderTop: "2px solid #DBB79A" }}>
                        <button
                          onClick={() => moveTreatStep(item.id, -1)}
                          disabled={!canMoveUp}
                          aria-label={`${L.menuMoveUp}: ${nameOf(item)}`}
                          style={{ flex: 1, border: "none", borderRight: "2px solid #DBB79A", background: "none", cursor: canMoveUp ? "pointer" : "default", opacity: canMoveUp ? 1 : 0.35, padding: "6px 0", fontSize: 11, color: "#9E4B54" }}
                        >↑</button>
                        <button
                          onClick={() => moveTreatStep(item.id, 1)}
                          disabled={!canMoveDown}
                          aria-label={`${L.menuMoveDown}: ${nameOf(item)}`}
                          style={{ flex: 1, border: "none", background: "none", cursor: canMoveDown ? "pointer" : "default", opacity: canMoveDown ? 1 : 0.35, padding: "6px 0", fontSize: 11, color: "#9E4B54" }}
                        >↓</button>
                      </span>
                    </div>
                  );
                };

                const zoneGrid = (zone: "counter" | "book", list: MenuItem[], emptyMsg: string) => (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOverZone(zone); }}
                    onDragLeave={() => setDragOverZone((z) => (z === zone ? null : z))}
                    onDrop={(e) => { e.preventDefault(); onZoneDrop(zone); }}
                    style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(128px,1fr))", gap: 8, padding: 11, minHeight: 96, background: dragOverZone === zone ? "#FDF0E2" : "#FFFDF6", boxShadow: `inset 0 0 0 3px ${dragOverZone === zone ? "#9E4B54" : "#DBB79A"}` }}
                  >
                    {list.length === 0 ? (
                      <span style={{ gridColumn: "1 / -1", padding: 14, textAlign: "center", fontSize: 11.5, lineHeight: 1.55, color: "#B07B6A" }}>{emptyMsg}</span>
                    ) : (
                      list.map((item, idx) => renderCard(item, zone, idx > 0, idx < list.length - 1))
                    )}
                  </div>
                );

                return (
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {/* left column */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.menuTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{items.length}</span>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <button onClick={startNewItem} style={{ ...saveBtnStyle, alignSelf: "auto" }}>{L.menuAddTreat}</button>
                        <input value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder={L.menuSearch} style={{ ...inputStyle, flex: 1, minWidth: 160, width: "auto" }} />
                      </div>

                      {/* shelves zone */}
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                        <span style={{ fontFamily: dot, fontSize: 15, color: "#7A3F49" }}>{L.shelvesTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#9E4B54" }}>{shelves.length}</span>
                        <span style={{ flex: 1, minWidth: 150, fontSize: 11, color: "#B07B6A" }}>{L.shelvesNote}</span>
                      </div>
                      {zoneGrid("counter", shelves, L.shelvesEmpty)}

                      {/* book zone */}
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                        <span style={{ fontFamily: dot, fontSize: 15, color: "#7A3F49" }}>{L.bookTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{book.length}</span>
                        <span style={{ flex: 1, minWidth: 150, fontSize: 11, color: "#B07B6A" }}>{L.bookNote}</span>
                      </div>
                      {zoneGrid("book", book, L.bookEmpty)}

                      {/* editor */}
                      {editing && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 13, background: "#FFFBF2", boxShadow: "inset 0 0 0 3px #9E4B54", marginTop: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{editing === "new" ? L.menuAddTreat : nameOf(editing)}</span>
                            <button onClick={cancelEditItem} style={editBtnStyle}>{L.done}</button>
                          </div>

                          <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                            {/* photo drop */}
                            <label
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadThumb(f); }}
                              style={{ flex: "none", position: "relative", width: 96, height: 96, cursor: "pointer", background: cardThumbBg(formThumb), boxShadow: "inset 0 0 0 2px #DBB79A", display: "grid", placeItems: "center", overflow: "hidden" }}
                            >
                              {!formThumb && <span style={{ fontSize: 9, color: "#9A6656", textAlign: "center", padding: 6, fontFamily: mono }}>{uploading ? L.uploading : L.edPhotoHint}</span>}
                              {formThumb && uploading && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(255,251,242,.75)", fontSize: 9, fontFamily: mono, color: "#9E4B54" }}>{L.uploading}</span>}
                              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadThumb(f); e.target.value = ""; }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
                            </label>
                            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "1fr 1fr 110px", gap: "6px 8px", alignItems: "end" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={fieldLabel}>{L.menuTh}</span>
                                <input value={formTh} onChange={(e) => setFormTh(e.target.value)} maxLength={60} style={inputStyle} />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={fieldLabel}>{L.menuEn}</span>
                                <input value={formEn} onChange={(e) => setFormEn(e.target.value)} maxLength={60} style={inputStyle} />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={fieldLabel}>{L.menuPrice}</span>
                                <input type="number" min={1} value={formPrice} onChange={(e) => setFormPrice(Number(e.target.value))} style={inputStyle} />
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            <button onClick={() => setFormHidden((h) => !h)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", border: "none", cursor: "pointer", background: formHidden ? "#FFF1E2" : "#FDD3E0", boxShadow: `inset 0 0 0 2px ${formHidden ? "#DBB79A" : "#9E4B54"}`, fontSize: 12, color: "#7A3F49" }}>{formHidden ? "☐" : "☑"} {L.edOnShelf}</button>
                            <button onClick={() => { if (editing !== "new") deleteItem(editing.id); }} disabled={editing === "new"} style={{ ...dangerBtnStyle, opacity: editing === "new" ? 0.4 : 1 }}>{L.menuDelete}</button>
                          </div>

                          {/* tags */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={fieldLabel}>{L.edTags}</span>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                              {formTags.map((t) => (
                                <span key={t} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 7px 6px 9px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 11.5, color: "#7A3F49" }}>
                                  {t}
                                  <button onClick={() => removeFormTag(t)} aria-label="remove tag" style={{ width: 16, height: 16, display: "grid", placeItems: "center", border: "none", cursor: "pointer", background: "#9E4B54", fontSize: 9, color: "#FFF1E2" }}>✕</button>
                                </span>
                              ))}
                              {formTags.length === 0 && <span style={{ fontSize: 11.5, color: "#B07B6A" }}>{L.edNoTags}</span>}
                              <button onClick={() => setTagPickerOpen((o) => !o)} aria-label="add tag" style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: "none", cursor: "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #9E4B54", fontFamily: mono, fontSize: 11, color: "#9E4B54" }}>{tagPickerOpen ? "–" : "+"}</button>
                            </div>
                            {tagPickerOpen && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54" }}>
                                <input value={tagPickerQ} onChange={(e) => setTagPickerQ(e.target.value)} placeholder={L.tagSearch} style={inputStyle} />
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                  {pickerOptions.map((o) => (
                                    <button key={o} onClick={() => addTag(o)} style={{ padding: "6px 9px", border: "none", cursor: "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 11.5, color: "#8E6B5B" }}>{o}</button>
                                  ))}
                                  {canCreate && (
                                    <button onClick={() => addTag(pq)} style={{ padding: "6px 9px", border: "none", cursor: "pointer", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 11.5, color: "#7A3F49" }}>{L.tagCreate(pq)}</button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Dialogue tails moved to the Voice page — a treat's
                              lines are authored alongside the pick template there. */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", background: "#FFF9EC", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 11.5, color: "#8E6B5B" }}>
                            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>{L.menuTailsMoved}</span>
                            <button onClick={() => setTab("voice")} style={{ flex: "none", border: "none", cursor: "pointer", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54", padding: "6px 10px", fontFamily: mono, fontSize: 9, color: "#7A3F49", whiteSpace: "nowrap" }}>{L.menuTailsMovedCta}</button>
                          </div>

                          <div style={{ display: "flex", gap: 10 }}>
                            <button onClick={submitItem} disabled={menuSaving || uploading} style={saveBtnStyle}>{menuSaving ? L.saving : L.save}</button>
                            <button onClick={cancelEditItem} style={editBtnStyle}>{L.cancel}</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* preview rail */}
                    <div style={{ flex: "none", width: 300, display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.previewTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#B07B6A" }}>LIVE</span>
                      </div>
                      {allTags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          <button onClick={() => setMenuFilter("")} style={previewChip(menuFilter === "")}>{L.tagAll}</button>
                          {allTags.map((t) => (
                            <button key={t} onClick={() => setMenuFilter(t)} style={previewChip(menuFilter === t)}>{t}</button>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, padding: 10, background: "#FFF9EC", boxShadow: "inset 0 0 0 3px #DBB79A" }}>
                        {previewShelves.map((p) => (
                          <span key={p.id} style={{ position: "relative", display: "block", width: "100%", background: "#EEDCBE", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                            <span style={{ display: "block", width: "100%", aspectRatio: "1 / 1", background: cardThumbBg(p.thumb_url) }} />
                            <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, padding: "4px 5px", background: "rgba(255,249,236,.92)" }}>
                              <span style={{ minWidth: 0, fontFamily: dot, fontSize: 9, color: "#7A3F49", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(p)}</span>
                              <span style={{ flex: "none", fontFamily: mono, fontSize: 7, color: "#9E4B54" }}>฿{p.price_thb}</span>
                            </span>
                          </span>
                        ))}
                        {previewShelves.length === 0 && <span style={{ gridColumn: "1 / -1", padding: 10, textAlign: "center", fontSize: 11, color: "#B07B6A" }}>{L.menuEmpty}</span>}
                      </div>
                    </div>
                  </div>
                );
                /* eslint-enable react-hooks/refs */
              })()}

              {tab === "privacy" && (
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  {/* left column */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* filter */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 14, background: "#FFF9EC", border: "3px solid #9E4B54" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontFamily: dot, fontSize: 18, color: "#7A3F49" }}>{L.filterTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#B07B6A" }}>{L.filterSub}</span>
                      </div>
                      <div style={{ display: "flex" }}>
                        {(["off", "standard"] as const).map((s) => (
                          <button key={s} onClick={() => setPrivacy((p) => ({ ...p, strictness: s }))} style={{ flex: 1, padding: "11px 12px", border: "none", cursor: "pointer", background: privacy.strictness === s ? "#9E4B54" : "#FFF1E2", color: privacy.strictness === s ? "#FFF1E2" : "#7A5C4B", fontFamily: dot, fontSize: 15 }}>
                            {s === "off" ? L.strictOff : L.strictStandard}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#8E6B5B" }}>{privacy.strictness === "off" ? L.strictNoteOff : L.strictNoteStandard}</div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 10, borderTop: "2px dashed #DBB79A" }}>
                        {([
                          ["message", L.actMessage, L.actMessageNote],
                          ["name", L.actName, L.actNameNote],
                          ["tts", L.actTts, L.actTtsNote],
                        ] as [keyof PrivacyConfig["actions"], string, string][]).map(([key, label, note]) => (
                          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                              <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                            </div>
                            <div style={{ flex: "none", display: "flex" }}>
                              {(["mask", "hold", "block"] as ModerationAction[]).map((a) => (
                                <button key={a} onClick={() => setPrivacy((p) => ({ ...p, actions: { ...p.actions, [key]: a } }))} style={{ padding: "7px 10px", border: "none", cursor: "pointer", background: privacy.actions[key] === a ? "#FDD3E0" : "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", fontFamily: mono, fontSize: 9, color: "#7A3F49", whiteSpace: "nowrap" }}>
                                  {a === "mask" ? L.aMask : a === "hold" ? L.aHold : L.aBlock}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* word lists */}
                    <div style={{ display: "flex", gap: 14 }}>
                      {([
                        ["blockWords", L.blockTitle, L.blockNote, "block"],
                        ["allowWords", L.allowTitle, L.allowNote, "allow"],
                      ] as [keyof Pick<PrivacyConfig, "blockWords" | "allowWords">, string, string, "block" | "allow"][]).map(([key, title, note, tone]) => (
                        <div key={key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{title}</span>
                            <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, minHeight: 34 }}>
                            {privacy[key].map((w) => (
                              <button key={w} onClick={() => removeWord(key, w)} aria-label={`Remove "${w}"`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", border: "none", cursor: "pointer", background: tone === "block" ? "#FDD3E0" : "#E4EFDD", boxShadow: `inset 0 0 0 2px ${tone === "block" ? "#C4818F" : "#A8C69A"}`, fontSize: 12, color: "#7A3F49" }}>
                                <span>{w}</span><span style={{ fontSize: 10, color: "#C4818F" }}>✕</span>
                              </button>
                            ))}
                          </div>
                          <div style={{ display: "flex" }}>
                            <input
                              value={key === "blockWords" ? blockDraft : allowDraft}
                              onChange={(e) => (key === "blockWords" ? setBlockDraft(e.target.value) : setAllowDraft(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                submitDraft(key);
                              }}
                              placeholder={L.wordPlaceholder}
                              style={{ ...inputStyle, width: "auto", flex: 1 }}
                            />
                            <button
                              onClick={() => submitDraft(key)}
                              style={{ flex: "none", padding: "10px 13px", border: "none", cursor: "pointer", background: tone === "block" ? "#9E4B54" : "#7A9E6B", color: "#FFF1E2", fontFamily: dot, fontSize: 14 }}
                            >
                              {L.addWordBtn}
                            </button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <label style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 11px", cursor: "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", fontFamily: mono, fontSize: 9, letterSpacing: ".06em", color: "#9E4B54" }}>
                              <span>{L.importBtn}</span>
                              <input type="file" accept=".txt,.csv,.json,text/plain,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importWordsFile(key, f); e.target.value = ""; }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
                            </label>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.4, color: "#B07B6A" }}>{L.importHint}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* hold rules */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.holdTitle}</span>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8E6B5B" }}>{L.holdNote}</div>
                      <button onClick={() => setPrivacy((p) => ({ ...p, queueOn: !p.queueOn }))} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: privacy.queueOn ? "#FDD3E0" : "#FFF1E2", boxShadow: `inset 0 0 0 2px ${privacy.queueOn ? "#9E4B54" : "#DBB79A"}` }}>
                        <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: privacy.queueOn ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{privacy.queueOn ? "✓" : ""}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{L.queueOnLabel}</span>
                          <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{L.queueOnNote}</span>
                        </span>
                      </button>
                      {([
                        ["firstTime", L.holdFirstTime, L.holdFirstTimeNote],
                        ["links", L.holdLinks, L.holdLinksNote],
                        ["long", L.holdLong, L.holdLongNote],
                        ["caps", L.holdCaps, L.holdCapsNote],
                        ["repeat", L.holdRepeat, L.holdRepeatNote],
                      ] as [keyof PrivacyConfig["holdRules"], string, string][]).map(([key, label, note]) => {
                        const checked = privacy.holdRules[key];
                        return (
                          <button key={key} onClick={() => setPrivacy((p) => ({ ...p, holdRules: { ...p.holdRules, [key]: !p.holdRules[key] } }))} role="checkbox" aria-checked={checked} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: checked ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${checked ? "#9E4B54" : "#DBB79A"}` }}>
                            <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: checked ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{checked ? "✓" : ""}</span>
                            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                              <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* right rail */}
                  <div style={{ flex: "none", width: 330, display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* guest privacy */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.guestPrivacyTitle}</span>
                      {([
                        ["anonDefault", L.anonDefaultLabel, L.anonDefaultNote],
                        ["sealedAllowed", L.sealedLabel, L.sealedNote],
                      ] as [keyof Pick<PrivacyConfig, "anonDefault" | "sealedAllowed">, string, string][]).map(([key, label, note]) => {
                        const checked = privacy[key];
                        return (
                          <button key={key} onClick={() => setPrivacy((p) => ({ ...p, [key]: !p[key] }))} role="checkbox" aria-checked={checked} style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", padding: "9px 10px", cursor: "pointer", border: "none", textAlign: "left", background: checked ? "#FDD3E0" : "#FFFBF2", boxShadow: `inset 0 0 0 2px ${checked ? "#9E4B54" : "#DBB79A"}` }}>
                            <span style={{ flex: "none", width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center", background: checked ? "#9E4B54" : "#FFF9EC", boxShadow: "inset 0 0 0 2px #9E4B54", fontSize: 9, lineHeight: 1, color: "#FFF1E2" }}>{checked ? "✓" : ""}</span>
                            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 12.5, color: "#7A3F49" }}>{label}</span>
                              <span style={{ fontSize: 11, lineHeight: 1.45, color: "#8E6B5B" }}>{note}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* queue */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.queueTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, color: "#9E4B54" }}>{queue.length}</span>
                      </div>
                      {queue.length === 0 ? (
                        <div style={{ padding: 16, background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 12, lineHeight: 1.6, color: "#B07B6A", textAlign: "center" }}>{L.queueEmpty}</div>
                      ) : (
                        queue.map((q) => {
                          const busy = queueBusy === q.payment_intent_id;
                          return (
                            <div key={q.payment_intent_id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 11, background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A", opacity: busy ? 0.6 : 1 }}>
                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontFamily: dot, fontSize: 14, color: "#7A3F49" }}>{q.customer_name}</span>
                                <span style={{ fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{(q.amount_minor / 100).toLocaleString()} {q.currency.toUpperCase()}</span>
                              </div>
                              {q.message && <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#6B4535" }}>{q.message}</div>}
                              {q.moderation_reason && (
                                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #E9A9B8" }}>
                                  <span style={{ flex: "none", width: 7, height: 7, background: "#9E4B54" }} />
                                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.4, color: "#6B2F3A" }}>{q.moderation_reason}</span>
                                </div>
                              )}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                <button onClick={() => queueAction(q.payment_intent_id, "approve")} disabled={busy} style={{ flex: "1 1 auto", minHeight: 38, padding: 9, border: "none", cursor: busy ? "default" : "pointer", background: "#9E4B54", color: "#FFF1E2", fontSize: 12 }}>{L.approve}</button>
                                <button onClick={() => queueAction(q.payment_intent_id, "reject")} disabled={busy} style={{ flex: "none", minHeight: 38, padding: "9px 11px", border: "none", cursor: busy ? "default" : "pointer", background: "#FFF1E2", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 12, color: "#C4818F" }}>{L.reject}</button>
                              </div>
                              {q.moderation_word && (
                                <button onClick={() => queueAction(q.payment_intent_id, "remember")} disabled={busy} style={{ width: "100%", minHeight: 36, padding: 8, border: "none", cursor: busy ? "default" : "pointer", background: "#EEDCBE", boxShadow: "inset 0 0 0 2px #DBB79A", fontSize: 11.5, color: "#7A5C4B", textAlign: "left" }}>{L.remember(q.moderation_word)}</button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* blocked log */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, background: "#FFF9EC", border: "3px solid #DBB79A" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontFamily: dot, fontSize: 17, color: "#7A3F49" }}>{L.logTitle}</span>
                        <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: ".1em", color: "#B07B6A" }}>{L.logSub}</span>
                      </div>
                      {modLog.length === 0 ? (
                        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#B07B6A" }}>{L.logEmpty}</div>
                      ) : (
                        modLog.map((l) => (
                          <div key={l.what} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "7px 9px", background: "#FFFBF2", boxShadow: "inset 0 0 0 2px #DBB79A" }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#7A5C4B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.what}</span>
                            <span style={{ flex: "none", fontFamily: mono, fontSize: 8, letterSpacing: ".06em", color: "#B07B6A" }}>×{l.count}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 50, border: "3px solid #9E4B54", background: "#FDD3E0", color: "#7A3F49", padding: "10px 18px", fontFamily: mono, fontSize: 11, boxShadow: "5px 5px 0 rgba(0,0,0,.28)" }}>{flash}</div>
      )}
    </div>
  );
}

// ── style helpers (matching app/dashboard/page.tsx's pixel system) ──────────
const rootStyle: React.CSSProperties = { position: "fixed", inset: 0, overflow: "auto", background: "#5F3A40", padding: 40, display: "flex", justifyContent: "center" };
const cardStyle: React.CSSProperties = { border: "5px solid #9E4B54", background: "#FDF5E4", padding: 18, boxShadow: "10px 10px 0 rgba(0,0,0,.28)", display: "flex", flexDirection: "column", gap: 16 };
const fieldLabel: React.CSSProperties = { fontFamily: mono, fontSize: 9, letterSpacing: ".08em", color: "#8A6A55" };
const inputStyle: React.CSSProperties = { width: "100%", border: "3px solid #DBB79A", background: "#FFF8EA", padding: "8px 10px", fontSize: 13, color: "#6B4535", fontFamily: "inherit" };

function segBtn(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "7px 12px", color: active ? "#7A3F49" : "#A98876", background: active ? "#FDD3E0" : "#FDF5E4" };
}
// Left category-rail item.
function navBtn(active: boolean): React.CSSProperties {
  return { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "10px 11px", cursor: "pointer", border: "none", textAlign: "left", fontFamily: dot, fontSize: 14, color: active ? "#7A3F49" : "#8E6B5B", background: active ? "#FDD3E0" : "#FFF9EC", boxShadow: `inset 0 0 0 3px ${active ? "#9E4B54" : "#DBB79A"}` };
}
const saveBtnStyle: React.CSSProperties = { alignSelf: "flex-start", border: "3px solid #9E4B54", background: "#FDD3E0", color: "#7A3F49", padding: "9px 18px", cursor: "pointer", fontFamily: mono, fontSize: 11 };
const addBtnStyle: React.CSSProperties = { alignSelf: "flex-start", border: "3px solid #9E4B54", background: "#FDF5E4", color: "#9E4B54", padding: "6px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9 };
const editBtnStyle: React.CSSProperties = { border: "3px solid #9E4B54", background: "#FDF5E4", color: "#9E4B54", padding: "6px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9, whiteSpace: "nowrap" };
const dangerBtnStyle: React.CSSProperties = { border: "3px solid #C4646F", background: "#FBDCDF", color: "#8C3742", padding: "6px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9, whiteSpace: "nowrap" };
function previewChip(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 8, letterSpacing: ".04em", padding: "5px 7px", color: active ? "#7A3F49" : "#8E6B5B", background: active ? "#FDD3E0" : "#FFF1E2", boxShadow: `inset 0 0 0 2px ${active ? "#9E4B54" : "#DBB79A"}` };
}
