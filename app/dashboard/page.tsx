"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, isCurrency, type Currency } from "@/lib/money";
import { type Lang } from "@/lib/i18n";
import { type TxFilter } from "@/lib/tx-filter";
import { supabaseBrowser } from "@/lib/supabase-browser";

// ── fonts (same three pixel families the tip page uses) ──────────────────────
const mono = "var(--font-silkscreen), monospace";
const dot = "var(--font-dotgothic), monospace";

type Range = "month" | "year" | "all";
type Anchor = { y: number; m: number };

type Kpis = {
  grossMinor: number;
  count: number;
  uniquePeople: number;
  avgMinor: number;
  medianMinor: number;
  biggestMinor: number;
  biggestWho: string;
  biggestAt: string | null;
  repeatRate: number;
  deltaPct: number | null;
};
type Analytics = {
  range: Range;
  anchor: Anchor;
  from: string;
  to: string;
  earliest: string;
  bucket: "day" | "month";
  kpis: Kpis;
  chart: { label: string; valueMinor: number; count: number; currencies: { currency: string; amountMinor: number }[] }[];
  topSupporters: { name: string; amountMinor: number; count: number }[];
};
type Txn = {
  id: string;
  createdAt: number;
  name: string;
  message: string;
  amountMinor: number;
  currency: string;
  showOnScreen: boolean;
  status: string;
  alertPlayedAt: string | null;
};
type Balance = { currency: string; amountMinor: number };

const MONTHS: Record<Lang, string[]> = {
  th: ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const DASH = {
  th: {
    subtitle: "แดชบอร์ดน้ำใจ",
    rMonth: "รายเดือน", rYear: "รายปี", rAll: "ทั้งหมด", jumpLatest: "ล่าสุด", vsPrev: "จากช่วงก่อน",
    kGross: "ยอดรวม", kCount: "จำนวนทิป", kAvg: "เฉลี่ยต่อครั้ง", kBiggest: "ทิปก้อนใหญ่สุด", kRepeat: "กลับมาทิปซ้ำ",
    kRepeatSub: "ของคนที่ทิปทั้งหมด", median: "มัธยฐาน", people: (n: number) => `${n} คน`, noOne: "—",
    chartDay: "ยอดทิปต่อวัน", chartMonth: "ยอดทิปต่อเดือน", chartNote: "ทั้งหมดเป็นเงินบาท (โดยประมาณ)",
    txTitle: "ข้อความและรายการทิป", txSub: "คุณเห็นข้อความเต็มทุกอันที่นี่ — รวมที่ส่งแบบส่วนตัว",
    searchPh: "ค้นหาชื่อหรือข้อความ...", fAll: "ทั้งหมด", fShown: "ขึ้นจอ", fPrivate: "ส่วนตัว", fQueue: "รอขึ้นจอ", fPending: "รอชำระ",
    tips: (n: number) => `${n} ทิป`,
    cTime: "เวลา", cStream: "บนสตรีม", cName: "ชื่อผู้ส่ง", cAmount: "จำนวน", cMessage: "ข้อความ",
    replay: "เล่นซ้ำ", replaySent: "ส่งแล้ว", noRows: "ไม่พบรายการที่ตรงกับการค้นหา", prev: "ก่อนหน้า", next: "ถัดไป",
    pageInfo: (a: number, b: number, t: number) => `${a}–${b} จาก ${t}`, csv: "CSV",
    stShown: "ขึ้นจอ", stPrivate: "ส่วนตัว", stQueued: "รอขึ้นจอ", noMsg: "—",
    stPending: "รอชำระ", stExpired: "หมดอายุ", stFailed: "ไม่สำเร็จ",
    overlayTitle: "การแจ้งเตือนบนจอ", alertsToday: "วันนี้", inQueue: "รอขึ้นจอ",
    testAlert: "ทดสอบแจ้งเตือน", testSent: "ส่งแล้ว ✓",
    overlayNote: "ปุ่มทดสอบจะส่งการแจ้งเตือนไปที่โอเวอร์เลย์ OBS ของคุณจริง",
    goalTitle: "เป้าหมายของร้าน", goalNone: "ยังไม่ได้ตั้งเป้าหมาย", goalLeft: (m: string) => `เหลืออีก ${m}`,
    topTitle: "ผู้สนับสนุนสูงสุด", topEmpty: "ยังไม่มีทิปในช่วงนี้", times: (n: number) => `${n} ครั้ง`,
    payoutTitle: "ยอดคงเหลือ Stripe", available: "พร้อมโอน", pendingBal: "กำลังเคลียร์", openStripe: "เปิดใน Stripe →",
    payoutEmpty: "ยังไม่มียอดคงเหลือ", payoutError: "อ่านยอดจาก Stripe ไม่สำเร็จ",
    signOut: "ออกจากระบบ", dashboard: "แดชบอร์ด", settingsLink: "ตั้งค่า",
    loading: "กำลังโหลด…", unauthorized: "กรุณาเข้าสู่ระบบเพื่อดูแดชบอร์ด", signIn: "ไปหน้าเข้าสู่ระบบ →",
    error: "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่",
    flashTest: "ส่งการแจ้งเตือนทดสอบขึ้นจอแล้ว", flashReplay: "แสดงอีกครั้งและอ่านออกเสียงแล้ว", flashFail: "ไม่สำเร็จ กรุณาลองใหม่",
  },
  en: {
    subtitle: "Tip dashboard",
    rMonth: "MONTHLY", rYear: "YEARLY", rAll: "ALL TIME", jumpLatest: "LATEST", vsPrev: "vs previous",
    kGross: "GROSS", kCount: "TIPS", kAvg: "AVG TIP", kBiggest: "BIGGEST TIP", kRepeat: "REPEAT RATE",
    kRepeatSub: "of everyone who tipped", median: "median", people: (n: number) => `${n} people`, noOne: "—",
    chartDay: "Tips per day", chartMonth: "Tips per month", chartNote: "all in THB (approx)",
    txTitle: "Messages & tips", txSub: "You see every message in full here — including private ones",
    searchPh: "Search name or message...", fAll: "ALL", fShown: "SHOWN", fPrivate: "PRIVATE", fQueue: "QUEUE", fPending: "PENDING",
    tips: (n: number) => `${n} tips`,
    cTime: "TIME", cStream: "ON STREAM", cName: "FROM", cAmount: "AMOUNT", cMessage: "MESSAGE",
    replay: "REPLAY", replaySent: "SENT", noRows: "No transactions match that search", prev: "PREV", next: "NEXT",
    pageInfo: (a: number, b: number, t: number) => `${a}–${b} of ${t}`, csv: "CSV",
    stShown: "SHOWN", stPrivate: "PRIVATE", stQueued: "QUEUED", noMsg: "—",
    stPending: "PENDING", stExpired: "EXPIRED", stFailed: "FAILED",
    overlayTitle: "On-stream alerts", alertsToday: "TODAY", inQueue: "IN QUEUE",
    testAlert: "TEST ALERT", testSent: "SENT ✓",
    overlayNote: "The test button sends a real alert to your OBS overlay.",
    goalTitle: "Café goal", goalNone: "No active goal", goalLeft: (m: string) => `${m} to go`,
    topTitle: "Top supporters", topEmpty: "No tips yet in this period", times: (n: number) => `${n} tips`,
    payoutTitle: "Stripe balance", available: "Available", pendingBal: "Clearing", openStripe: "Open in Stripe →",
    payoutEmpty: "No balance yet", payoutError: "Couldn't read the Stripe balance",
    signOut: "SIGN OUT", dashboard: "DASHBOARD", settingsLink: "SETTINGS",
    loading: "Loading…", unauthorized: "Please sign in to view the dashboard.", signIn: "Go to sign-in →",
    error: "Couldn't load data. Please try again.",
    flashTest: "Test alert sent to the overlay", flashReplay: "Alert re-shown and read aloud", flashFail: "Failed — please try again",
  },
} as const;

const bahtMinor = (m: number) => formatMoney(m, "thb");

// "28/7 04:35"
function shortStamp(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Compact ฿ for the on-bar labels: ฿120 / ฿2.4k / ฿18k.
function compactBaht(minor: number): string {
  const v = minor / 100;
  if (v >= 1000) return "฿" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
  return "฿" + Math.round(v).toLocaleString("en-US");
}
// Human date for a bar's tooltip: "Fri, 14 Aug" (day bucket) / "Aug 2026" (month).
function bucketDate(label: string, bucket: "day" | "month", anchor: Anchor, lang: Lang): string {
  const locale = lang === "th" ? "th-TH" : "en-GB";
  if (bucket === "day") {
    const d = new Date(Date.UTC(anchor.y, anchor.m, Number(label)));
    return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  const [yy, mm] = label.split("-").map(Number);
  return new Date(Date.UTC(yy, mm, 1)).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function Dashboard() {
  const [lang, setLang] = useState<Lang>("th");
  const L = DASH[lang];

  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<Range>("month");
  const [anchor, setAnchor] = useState<Anchor>({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [pickOpen, setPickOpen] = useState(false);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [goal, setGoal] = useState<{ label: string; targetThb: number; raisedThb: number } | null>(null);
  const [balance, setBalance] = useState<{ available: Balance[]; pending: Balance[]; url: string } | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [overlay, setOverlay] = useState<{ alertsToday: number; inQueue: number } | null>(null);

  const [txns, setTxns] = useState<Txn[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txPageCount, setTxPageCount] = useState(1);
  const [txTotal, setTxTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TxFilter>("all");
  const [hoverBar, setHoverBar] = useState<number | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [replay, setReplay] = useState<{ id: string; phase: "sending" | "sent" } | null>(null);
  const [testing, setTesting] = useState<"idle" | "sending" | "sent">("idle");
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function showFlash(msg: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(msg);
    flashTimer.current = setTimeout(() => setFlash(null), 3200);
  }
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // ── analytics (range/anchor driven) ────────────────────────────────────────
  const loadAnalytics = useCallback(async () => {
    const anc = range === "month" ? `${anchor.y}-${anchor.m + 1}` : range === "year" ? `${anchor.y}` : "";
    try {
      const res = await fetch(`/api/dashboard/analytics?range=${range}&anchor=${anc}`);
      if (res.status === 401 || res.status === 403) { setStatus("unauthorized"); return; }
      if (!res.ok) { setStatus("error"); return; }
      setAnalytics((await res.json()) as Analytics);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [range, anchor]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAnalytics();
  }, [loadAnalytics]);

  // ── goal / payout / overlay (range-independent, load once) ──────────────────
  useEffect(() => {
    (async () => {
      try {
        const g = await fetch("/api/goal").then((r) => r.json());
        if (g?.goal) setGoal({ label: g.goal.label ?? "", targetThb: g.goal.targetThb, raisedThb: g.goal.raisedThb });
      } catch { /* leave null */ }
    })();
    (async () => {
      try {
        const res = await fetch("/api/payout");
        if (!res.ok) { setBalanceError(true); return; }
        const b = await res.json();
        setBalance({ available: b.available ?? [], pending: b.pending ?? [], url: b.dashboardUrl });
      } catch { setBalanceError(true); }
    })();
  }, []);

  const loadOverlay = useCallback(async () => {
    try {
      const res = await fetch("/api/overlay-status");
      if (res.ok) setOverlay(await res.json());
    } catch { /* leave null */ }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOverlay();
  }, [loadOverlay]);

  // ── transactions (search / visibility / page driven) ────────────────────────
  const loadTxns = useCallback(async () => {
    const params = new URLSearchParams({ page: String(txPage) });
    if (search.trim()) params.set("q", search.trim());
    if (filter !== "all") params.set("filter", filter);
    try {
      const res = await fetch(`/api/transactions?${params}`);
      if (res.status === 401 || res.status === 403) { setStatus("unauthorized"); return; }
      if (!res.ok) return;
      const data = await res.json();
      setTxns(data.transactions ?? []);
      setTxPageCount(data.pageCount ?? 1);
      setTxTotal(data.total ?? 0);
    } catch { /* keep prior rows */ }
  }, [txPage, search, filter]);

  useEffect(() => {
    const t = setTimeout(loadTxns, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadTxns, search]);

  // Filter changes reset to page 1 (done in the handlers, not an effect).
  function changeSearch(v: string) { setSearch(v); setTxPage(1); }
  function changeFilter(v: TxFilter) { setFilter(v); setTxPage(1); }

  async function sendReplay(id: string) {
    if (replay) return;
    setReplay({ id, phase: "sending" });
    try {
      const res = await fetch("/api/admin/replay", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentIntentId: id }),
      });
      if (!res.ok) { setReplay(null); showFlash(L.flashFail); return; }
      setReplay({ id, phase: "sent" });
      showFlash(L.flashReplay);
      setTimeout(() => setReplay(null), 4000);
    } catch { setReplay(null); showFlash(L.flashFail); }
  }

  async function sendTest() {
    if (testing === "sending") return;
    setTesting("sending");
    try {
      const res = await fetch("/api/admin/test-alert", { method: "POST" });
      if (!res.ok) { setTesting("idle"); showFlash(L.flashFail); return; }
      setTesting("sent");
      showFlash(L.flashTest);
      loadOverlay();
      setTimeout(() => setTesting("idle"), 4000);
    } catch { setTesting("idle"); showFlash(L.flashFail); }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }

  // ── period stepper / picker bounds ──────────────────────────────────────────
  const earliest = analytics ? new Date(analytics.earliest) : now;
  const minY = earliest.getUTCFullYear();
  const minM = earliest.getUTCMonth();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth();
  const idx = (a: Anchor) => a.y * 12 + a.m;
  const atLatest = range === "year" ? anchor.y >= curY : idx(anchor) >= curY * 12 + curM;
  const atEarliest = range === "year" ? anchor.y <= minY : idx(anchor) <= minY * 12 + minM;

  function stepPeriod(delta: number) {
    if (range === "year") {
      const y = Math.min(curY, Math.max(minY, anchor.y + delta));
      setAnchor({ y, m: 0 });
    } else {
      const i = Math.min(curY * 12 + curM, Math.max(minY * 12 + minM, idx(anchor) + delta));
      setAnchor({ y: Math.floor(i / 12), m: i % 12 });
    }
  }
  function jumpLatest() {
    setAnchor(range === "year" ? { y: curY, m: 0 } : { y: curY, m: curM });
    setPickOpen(false);
  }

  const periodLabel =
    range === "all"
      ? L.rAll
      : range === "year"
        ? String(anchor.y)
        : `${MONTHS[lang][anchor.m]} ${anchor.y}`;

  const rangeTitle = periodLabel;
  const rangeSub = analytics
    ? `${new Date(analytics.from).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB")} – ${new Date(analytics.to).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB")}`
    : "";

  const k = analytics?.kpis;
  const chartMax = Math.max(1, ...(analytics?.chart.map((c) => c.valueMinor) ?? [0]));

  // ── render ──────────────────────────────────────────────────────────────────
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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ width: 1440, display: "flex", flexDirection: "column", gap: 10 }}>
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
              {/* range presets */}
              <span style={{ display: "flex", border: "3px solid #9E4B54" }}>
                {(["month", "year", "all"] as Range[]).map((r) => (
                  <button key={r} onClick={() => { setRange(r); setPickOpen(false); }} style={segBtn(range === r)}>
                    {r === "month" ? L.rMonth : r === "year" ? L.rYear : L.rAll}
                  </button>
                ))}
              </span>
              {/* period picker (month/year only) */}
              {range !== "all" && (
                <span style={{ position: "relative", display: "flex", alignItems: "stretch", border: "3px solid #9E4B54", background: "#FDF5E4" }}>
                  <button onClick={() => stepPeriod(-1)} disabled={atEarliest} aria-label="previous" style={stepBtn(atEarliest)}>‹</button>
                  <button onClick={() => setPickOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 118, justifyContent: "center", border: "none", cursor: "pointer", padding: "5px 6px", background: pickOpen ? "#FDD3E0" : "#FDF5E4", fontFamily: mono, fontSize: 10, color: "#7A3F49" }}>
                    <span>{periodLabel}</span><span style={{ fontSize: 8, color: "#9E4B54" }}>▼</span>
                  </button>
                  <button onClick={() => stepPeriod(1)} disabled={atLatest} aria-label="next" style={stepBtn(atLatest)}>›</button>
                  {pickOpen && (
                    <span style={{ position: "absolute", top: "100%", right: -3, marginTop: 6, zIndex: 40, display: "flex", flexDirection: "column", gap: 9, width: 250, padding: 11, background: "#FDF5E4", border: "3px solid #9E4B54", boxShadow: "6px 6px 0 rgba(0,0,0,.26)" }}>
                      {range === "month" ? (
                        <>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <button onClick={() => setAnchor((a) => ({ y: Math.max(minY, a.y - 1), m: a.m }))} disabled={anchor.y <= minY} style={stepBtn(anchor.y <= minY)}>‹</button>
                            <span style={{ fontFamily: mono, fontSize: 11, color: "#7A3F49" }}>{anchor.y}</span>
                            <button onClick={() => setAnchor((a) => ({ y: Math.min(curY, a.y + 1), m: a.m }))} disabled={anchor.y >= curY} style={stepBtn(anchor.y >= curY)}>›</button>
                          </span>
                          <span style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
                            {MONTHS[lang].map((label, mi) => {
                              const off = anchor.y * 12 + mi < minY * 12 + minM || anchor.y * 12 + mi > curY * 12 + curM;
                              const on = anchor.m === mi;
                              return (
                                <button key={mi} disabled={off} onClick={() => { setAnchor({ y: anchor.y, m: mi }); setPickOpen(false); }}
                                  style={{ padding: "8px 4px", border: "none", cursor: off ? "default" : "pointer", background: on ? "#FDD3E0" : "#FFF8EA", boxShadow: `inset 0 0 0 2px ${on ? "#9E4B54" : "#E4CFAE"}`, fontFamily: mono, fontSize: 9, color: off ? "#C9B79F" : "#7A3F49", opacity: off ? 0.5 : 1 }}>
                                  {label}
                                </button>
                              );
                            })}
                          </span>
                        </>
                      ) : (
                        <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {Array.from({ length: curY - minY + 1 }, (_, i) => minY + i).map((yy) => (
                            <button key={yy} onClick={() => { setAnchor({ y: yy, m: 0 }); setPickOpen(false); }}
                              style={{ display: "flex", justifyContent: "space-between", padding: "9px 10px", border: "none", cursor: "pointer", background: anchor.y === yy ? "#FDD3E0" : "#FFF8EA", boxShadow: `inset 0 0 0 2px ${anchor.y === yy ? "#9E4B54" : "#E4CFAE"}`, fontFamily: mono, fontSize: 10, color: "#7A3F49" }}>
                              {yy}
                            </button>
                          ))}
                        </span>
                      )}
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingTop: 8, borderTop: "2px dashed #DBB79A" }}>
                        <button onClick={jumpLatest} style={{ border: "none", cursor: "pointer", background: "#FDD3E0", boxShadow: "inset 0 0 0 2px #9E4B54", padding: "5px 9px", fontFamily: mono, fontSize: 9, color: "#7A3F49" }}>{L.jumpLatest}</button>
                      </span>
                    </span>
                  )}
                </span>
              )}
              <span style={{ display: "flex", border: "3px solid #9E4B54" }}>
                {(["th", "en"] as Lang[]).map((l) => (
                  <button key={l} onClick={() => setLang(l)} style={segBtn(lang === l)}>{l.toUpperCase()}</button>
                ))}
              </span>
              <a href="/settings" style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "6px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{L.settingsLink}</a>
              <button onClick={signOut} style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "6px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{L.signOut}</button>
            </div>
          </div>

          {status === "loading" && !analytics ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontFamily: dot, fontSize: 16, color: "#A8836F" }}>{L.loading}</div>
          ) : status === "error" ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.error}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: dot, fontSize: 17, color: "#9E4B54" }}>{rangeTitle}</span>
                <span style={{ fontSize: 12, color: "#A8836F" }}>{rangeSub}</span>
              </div>

              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                <div style={kpiCard(true)}>
                  <div style={kpiLabel}>{L.kGross}</div>
                  <div style={kpiValue("#9E4B54")}>{k ? bahtMinor(k.grossMinor) : "—"}</div>
                  {k && k.deltaPct != null ? (
                    <div style={{ fontSize: 11, color: k.deltaPct >= 0 ? "#5F7D3F" : "#B4534E" }}>
                      {k.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(k.deltaPct)}% {L.vsPrev}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#A8836F" }}>{L.rAll === periodLabel ? "" : " "}</div>
                  )}
                </div>
                <div style={kpiCard(false)}>
                  <div style={kpiLabel}>{L.kCount}</div>
                  <div style={kpiValue("#6B4535")}>{k?.count ?? 0}</div>
                  <div style={{ fontSize: 11, color: "#A8836F" }}>{L.people(k?.uniquePeople ?? 0)}</div>
                </div>
                <div style={kpiCard(false)}>
                  <div style={kpiLabel}>{L.kAvg}</div>
                  <div style={kpiValue("#6B4535")}>{k ? bahtMinor(k.avgMinor) : "—"}</div>
                  <div style={{ fontSize: 11, color: "#A8836F" }}>{L.median} {k ? bahtMinor(k.medianMinor) : "—"}</div>
                </div>
                <div style={kpiCard(false)}>
                  <div style={kpiLabel}>{L.kBiggest}</div>
                  <div style={kpiValue("#6B4535")}>{k && k.biggestMinor ? bahtMinor(k.biggestMinor) : "—"}</div>
                  <div style={{ fontSize: 11, color: "#A8836F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {k && k.biggestWho ? `${k.biggestWho}${k.biggestAt ? " · " + new Date(k.biggestAt).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short" }) : ""}` : L.noOne}
                  </div>
                </div>
                <div style={kpiCard(false)}>
                  <div style={kpiLabel}>{L.kRepeat}</div>
                  <div style={kpiValue("#6B4535")}>{k?.repeatRate ?? 0}%</div>
                  <div style={{ fontSize: 11, color: "#A8836F" }}>{L.kRepeatSub}</div>
                </div>
              </div>

              {/* body: left (chart + table) + right rail */}
              <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* chart */}
                  <div style={{ border: "3px solid #DBB79A", background: "#FFFDF6", padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{analytics?.bucket === "day" ? L.chartDay : L.chartMonth}</div>
                      <div style={{ fontSize: 11, color: "#A8836F" }}>{L.chartNote}</div>
                    </div>
                    <div style={{ position: "relative", display: "flex", alignItems: "flex-end", height: 148, paddingBottom: 2, borderBottom: "3px solid #DBB79A", gap: (analytics?.chart.length ?? 0) > 20 ? 2 : 6 }}>
                      {(analytics?.chart ?? []).map((c, i) => {
                        const h = Math.round((c.valueMinor / chartMax) * 116);
                        const on = c.valueMinor > 0;
                        const hovered = hoverBar === i;
                        return (
                          <div key={i} onMouseEnter={() => setHoverBar(i)} onMouseLeave={() => setHoverBar((v) => (v === i ? null : v))}
                            style={{ position: "relative", flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                            {on && <span style={{ fontFamily: mono, fontSize: 8, color: hovered ? "#9E4B54" : "#A8836F", marginBottom: 3, whiteSpace: "nowrap" }}>{compactBaht(c.valueMinor)}</span>}
                            <span style={{ width: "100%", height: Math.max(2, h), background: !on ? "#F0E2CC" : hovered ? "#EE93AB" : "#F4A9BD", border: on ? "2px solid #C4818F" : "none", transition: "background .1s steps(2)" }} />
                            {hovered && analytics && (
                              <span style={{ position: "absolute", bottom: Math.max(2, h) + 12, left: "50%", transform: "translateX(-50%)", zIndex: 40, display: "flex", flexDirection: "column", gap: 3, whiteSpace: "nowrap", padding: "7px 11px", background: "#7A3F49", border: "3px solid #9E4B54", boxShadow: "4px 4px 0 rgba(0,0,0,.3)", pointerEvents: "none" }}>
                                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".06em", color: "#F2D9C6" }}>{bucketDate(c.label, analytics.bucket, analytics.anchor, lang)}</span>
                                <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                  {c.currencies.length === 0 ? (
                                    <span style={{ fontFamily: dot, fontSize: 14, color: "#FFF1E2" }}>{bahtMinor(0)}</span>
                                  ) : (
                                    c.currencies.map((cur) => (
                                      <span key={cur.currency} style={{ fontFamily: dot, fontSize: 14, color: "#FFF1E2" }}>
                                        {isCurrency(cur.currency) ? formatMoney(cur.amountMinor, cur.currency) : `${cur.amountMinor} ${cur.currency.toUpperCase()}`}
                                      </span>
                                    ))
                                  )}
                                </span>
                                <span style={{ fontSize: 10, color: "#FDD3E0" }}>{L.tips(c.count)}</span>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: (analytics?.chart.length ?? 0) > 20 ? 2 : 6 }}>
                      {(analytics?.chart ?? []).map((c, i) => {
                        const show = analytics?.bucket === "month" || (analytics?.chart.length ?? 0) <= 16 || i % 3 === 0;
                        const label = analytics?.bucket === "day" ? c.label : MONTHS[lang][Number(c.label.split("-")[1])];
                        return <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "#6B4535", minWidth: 0, overflow: "hidden" }}>{show ? label : ""}</span>;
                      })}
                    </div>
                  </div>

                  {/* transactions */}
                  <div style={{ flex: 1, minHeight: 0, border: "3px solid #DBB79A", background: "#FFFDF6", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "3px solid #DBB79A" }}>
                      <div>
                        <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.txTitle}</div>
                        <div style={{ fontSize: 11, color: "#A8836F", marginTop: 2 }}>{L.txSub}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input value={search} onChange={(e) => changeSearch(e.target.value)} maxLength={100} placeholder={L.searchPh}
                          style={{ width: 196, border: "3px solid #DBB79A", background: "#FFF8EA", padding: "7px 10px", fontSize: 13, color: "#6B4535", outline: "none" }} />
                        <span style={{ display: "flex", border: "3px solid #DBB79A" }}>
                          {([["all", L.fAll], ["shown", L.fShown], ["private", L.fPrivate], ["queue", L.fQueue], ["pending", L.fPending]] as [TxFilter, string][]).map(([f, label]) => (
                            <button key={f} onClick={() => changeFilter(f)} style={filtBtn(filter === f)}>{label}</button>
                          ))}
                        </span>
                        <a href={`/api/transactions/export?${new URLSearchParams({ ...(search.trim() ? { q: search.trim() } : {}), ...(filter !== "all" ? { filter } : {}) })}`}
                          style={{ border: "3px solid #9E4B54", background: "#FDF5E4", padding: "6px 11px", fontFamily: mono, fontSize: 9, color: "#9E4B54", whiteSpace: "nowrap" }}>↓ {L.csv}</a>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "88px 104px 132px 76px 1fr 80px", padding: "9px 16px", background: "#F6E7CE", borderBottom: "3px solid #DBB79A", fontFamily: mono, fontSize: 9, letterSpacing: ".06em", color: "#8A6A55" }}>
                      <span>{L.cTime}</span><span>{L.cStream}</span><span>{L.cName}</span><span>{L.cAmount}</span><span>{L.cMessage}</span><span />
                    </div>
                    <div data-pixel-scroll style={{ minHeight: 360 }}>
                      {txns.length === 0 ? (
                        <div style={{ padding: "30px 16px", textAlign: "center", fontSize: 13, color: "#A8836F" }}>{L.noRows}</div>
                      ) : (
                        txns.map((t) => {
                          const tag = streamTag(t, L);
                          const canReplay = t.status === "SUCCESS" && t.showOnScreen && !!t.alertPlayedAt;
                          return (
                            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "88px 104px 132px 76px 1fr 80px", alignItems: "start", padding: "11px 16px", borderBottom: "2px dashed #EADCC4" }}>
                              <span style={{ fontFamily: mono, fontSize: 9, color: "#A8836F", paddingTop: 2 }}>{shortStamp(t.createdAt)}</span>
                              <span>
                                <span style={{ display: "inline-block", padding: "3px 8px", fontFamily: mono, fontSize: 9, border: `2px solid ${tag.border}`, background: tag.bg, color: tag.fg }}>{tag.label}</span>
                              </span>
                              <span style={{ fontSize: 14, lineHeight: 1.35, color: "#6B4535", paddingRight: 10, overflowWrap: "anywhere" }}>{t.name}</span>
                              <span style={{ fontFamily: dot, fontSize: 15, color: "#9E4B54" }}>{isCurrency(t.currency) ? formatMoney(t.amountMinor, t.currency) : ""}</span>
                              <span style={{ fontSize: 13, lineHeight: 1.5, color: "#6B4535", maxHeight: "4.5em", overflow: "hidden", paddingRight: 14, minWidth: 0, textWrap: "pretty" }}>{t.message || L.noMsg}</span>
                              <span style={{ justifySelf: "end" }}>
                                {canReplay && (
                                  <button onClick={() => sendReplay(t.id)} disabled={replay !== null}
                                    style={{ border: "3px solid #C4818F", background: replay?.id === t.id && replay.phase === "sent" ? "#EAF6EC" : "#FDE9EF", color: "#8C3F4C", padding: "5px 8px", cursor: replay ? "default" : "pointer", fontFamily: mono, fontSize: 9, opacity: replay && replay.id !== t.id ? 0.5 : 1 }}>
                                    {replay?.id === t.id && replay.phase === "sent" ? L.replaySent : `▶ ${L.replay}`}
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {txTotal > 0 && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", background: "#F6E7CE", borderTop: "3px solid #DBB79A" }}>
                        <span style={{ fontSize: 11, color: "#8A6A55" }}>{L.pageInfo((txPage - 1) * 12 + 1, Math.min(txPage * 12, txTotal), txTotal)}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <button onClick={() => setTxPage((p) => Math.max(1, p - 1))} disabled={txPage <= 1} style={pageBtn(txPage <= 1)}>◀ {L.prev}</button>
                          <span style={{ fontFamily: mono, fontSize: 10, color: "#7A3F49" }}>{txPage} / {txPageCount}</span>
                          <button onClick={() => setTxPage((p) => Math.min(txPageCount, p + 1))} disabled={txPage >= txPageCount} style={pageBtn(txPage >= txPageCount)}>{L.next} ▶</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* right rail */}
                <div style={{ flex: "0 0 348px", display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* overlay */}
                  <div style={{ border: "3px solid #9E4B54", background: "#FFF8EA", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
                    <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.overlayTitle}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                      <div style={{ border: "2px solid #DBB79A", background: "#FFFDF6", padding: "9px 11px" }}>
                        <div style={{ fontFamily: mono, fontSize: 8, color: "#A8836F" }}>{L.alertsToday}</div>
                        <div style={{ fontFamily: dot, fontSize: 20, color: "#6B4535" }}>{overlay?.alertsToday ?? "—"}</div>
                      </div>
                      <div style={{ border: "2px solid #DBB79A", background: "#FFFDF6", padding: "9px 11px" }}>
                        <div style={{ fontFamily: mono, fontSize: 8, color: "#A8836F" }}>{L.inQueue}</div>
                        <div style={{ fontFamily: dot, fontSize: 20, color: "#6B4535" }}>{overlay?.inQueue ?? "—"}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.55, color: "#A8836F", textWrap: "pretty" }}>{L.overlayNote}</div>
                    <button onClick={sendTest} disabled={testing === "sending"}
                      style={{ border: "3px solid #9E4B54", background: testing === "sent" ? "#EAF6EC" : "#FDD3E0", color: "#7A3F49", padding: "8px 10px", cursor: testing === "sending" ? "default" : "pointer", fontFamily: mono, fontSize: 10 }}>
                      {testing === "sent" ? L.testSent : L.testAlert}
                    </button>
                  </div>

                  {/* goal */}
                  <div style={{ border: "3px solid #DBB79A", background: "#FFFDF6", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.goalTitle}</div>
                    {goal ? (
                      <>
                        <div style={{ fontSize: 12, color: "#6B4535" }}>{goal.label || ""}</div>
                        <div style={{ height: 20, border: "3px solid #9E4B54", background: "#F6E7CE", padding: 2 }}>
                          <div style={{ height: "100%", background: "repeating-linear-gradient(90deg,#F4A9BD 0 7px,#EE93AB 7px 14px)", width: `${Math.min(100, (goal.raisedThb / goal.targetThb) * 100)}%` }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B4535" }}>
                          <span style={{ fontFamily: dot, fontSize: 15, color: "#9E4B54" }}>{formatMoney(goal.raisedThb * 100, "thb")}</span>
                          <span style={{ color: "#A8836F" }}>/ {formatMoney(goal.targetThb * 100, "thb")} · {L.goalLeft(formatMoney(Math.max(0, goal.targetThb - goal.raisedThb) * 100, "thb"))}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: "#A8836F" }}>{L.goalNone}</div>
                    )}
                  </div>

                  {/* top supporters */}
                  <div style={{ border: "3px solid #DBB79A", background: "#FFFDF6", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.topTitle}</div>
                    {(analytics?.topSupporters.length ?? 0) === 0 ? (
                      <div style={{ fontSize: 12, color: "#A8836F" }}>{L.topEmpty}</div>
                    ) : (
                      analytics?.topSupporters.map((s, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 20, height: 20, flex: "none", display: "grid", placeItems: "center", background: i === 0 ? "#FDD3E0" : "#F6E7CE", border: "2px solid #9E4B54", fontFamily: mono, fontSize: 9, color: "#7A3F49" }}>{i + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "#6B4535", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                          <span style={{ fontSize: 11, color: "#A8836F" }}>{L.times(s.count)}</span>
                          <span style={{ fontFamily: dot, fontSize: 15, color: "#9E4B54" }}>{bahtMinor(s.amountMinor)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* payout */}
                  <div style={{ border: "3px solid #9E4B54", background: "#FDF0E2", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{L.payoutTitle}</div>
                    {balanceError ? (
                      <div style={{ fontSize: 12, color: "#A8836F" }}>{L.payoutError}</div>
                    ) : !balance ? (
                      <div style={{ fontSize: 12, color: "#A8836F" }}>{L.loading}</div>
                    ) : balance.available.length === 0 && balance.pending.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#A8836F" }}>{L.payoutEmpty}</div>
                    ) : (
                      <>
                        {balance.available.map((b) => (
                          <div key={"a" + b.currency} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6B4535" }}>
                            <span>{L.available} ({b.currency.toUpperCase()})</span>
                            <span style={{ fontFamily: dot, fontSize: 16, color: "#9E4B54" }}>{isCurrency(b.currency) ? formatMoney(b.amountMinor, b.currency as Currency) : b.amountMinor}</span>
                          </div>
                        ))}
                        {balance.pending.map((b) => (
                          <div key={"p" + b.currency} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6B4535" }}>
                            <span>{L.pendingBal} ({b.currency.toUpperCase()})</span>
                            <span style={{ color: "#A8836F" }}>{isCurrency(b.currency) ? formatMoney(b.amountMinor, b.currency as Currency) : b.amountMinor}</span>
                          </div>
                        ))}
                      </>
                    )}
                    <a href={balance?.url ?? "https://dashboard.stripe.com/balance"} target="_blank" rel="noopener noreferrer"
                      style={{ marginTop: 2, paddingTop: 9, borderTop: "2px dashed #DBB79A", fontFamily: mono, fontSize: 10, color: "#9E4B54" }}>{L.openStripe}</a>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 50, border: "3px solid #9E4B54", background: "#FDD3E0", color: "#7A3F49", padding: "10px 18px", fontFamily: mono, fontSize: 11, boxShadow: "5px 5px 0 rgba(0,0,0,.28)" }}>{flash}</div>
      )}
    </div>
  );
}

// ── on-stream state tag for a transaction row ────────────────────────────────
type DashL = (typeof DASH)[Lang];
function streamTag(t: Txn, L: DashL): { label: string; bg: string; border: string; fg: string } {
  if (t.status === "PENDING") return { label: L.stPending, bg: "#FBF0D6", border: "#C9A24B", fg: "#8A6A22" };
  if (t.status === "EXPIRED") return { label: L.stExpired, bg: "#FFFDF6", border: "#EADCC4", fg: "#A8836F" };
  if (t.status === "FAILED") return { label: L.stFailed, bg: "#F7DCDA", border: "#B4534E", fg: "#8C3A36" };
  if (!t.showOnScreen) return { label: L.stPrivate, bg: "#EADCF2", border: "#8A6FA0", fg: "#5F4373" };
  if (!t.alertPlayedAt) return { label: L.stQueued, bg: "#FBF0D6", border: "#C9A24B", fg: "#8A6A22" };
  return { label: L.stShown, bg: "#EAF2E1", border: "#6E8F5E", fg: "#4E6B41" };
}

// ── style helpers ────────────────────────────────────────────────────────────
const rootStyle: React.CSSProperties = { position: "fixed", inset: 0, overflow: "auto", background: "#5F3A40", padding: 40, display: "flex", justifyContent: "center" };
const cardStyle: React.CSSProperties = { border: "5px solid #9E4B54", background: "#FDF5E4", padding: 18, boxShadow: "10px 10px 0 rgba(0,0,0,.28)", display: "flex", flexDirection: "column", gap: 16 };
const kpiLabel: React.CSSProperties = { fontFamily: mono, fontSize: 9, letterSpacing: ".1em", color: "#A8836F" };
function kpiCard(primary: boolean): React.CSSProperties {
  return { border: `3px solid ${primary ? "#9E4B54" : "#DBB79A"}`, background: primary ? "#FFF8EA" : "#FFFDF6", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 5 };
}
function kpiValue(color: string): React.CSSProperties {
  return { fontFamily: dot, fontSize: 30, lineHeight: 1, color };
}
function segBtn(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "7px 12px", color: active ? "#7A3F49" : "#A98876", background: active ? "#FDD3E0" : "#FDF5E4" };
}
function stepBtn(off: boolean): React.CSSProperties {
  return { border: "none", background: "none", cursor: off ? "default" : "pointer", padding: "5px 9px", fontFamily: dot, fontSize: 15, lineHeight: 1, color: off ? "#CBB49F" : "#9E4B54" };
}
function filtBtn(active: boolean): React.CSSProperties {
  return { border: "none", cursor: "pointer", fontFamily: mono, fontSize: 9, padding: "7px 9px", color: active ? "#7A3F49" : "#A98876", background: active ? "#FDD3E0" : "#FFFDF6" };
}
function pageBtn(off: boolean): React.CSSProperties {
  return { border: `3px solid ${off ? "#DBB79A" : "#9E4B54"}`, background: "#FFFDF6", color: off ? "#CBB49F" : "#7A3F49", padding: "5px 10px", cursor: off ? "default" : "pointer", fontFamily: mono, fontSize: 9 };
}

const CSS = `
  [data-pixel-scroll] { scrollbar-width: thin; scrollbar-color: #c4818f #eedcbe; }
  [data-pixel-scroll]::-webkit-scrollbar { width: 14px; }
  [data-pixel-scroll]::-webkit-scrollbar-track { background: #eedcbe; }
  [data-pixel-scroll]::-webkit-scrollbar-thumb { background: #c4818f; border: 3px solid #9e4b54; }
`;
