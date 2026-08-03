"use client";

import { useEffect, useRef, useState } from "react";
import {
  CURRENCIES,
  formatMoney,
  fromMinorUnits,
  spokenAmount,
  isCurrency,
  type Currency,
} from "@/lib/money";
import { BRAND_NAME } from "@/lib/brand";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ALERT_EVENT, channelName, type AlertPayload } from "@/lib/realtime.shared";

type Alert = AlertPayload;

// Realtime carries alerts within about a second. This poll is the safety net
// for anything the socket missed while it was down — Broadcast does not replay
// messages — and it is also what drives the reconciliation sweep on Vercel
// Hobby, where cron only fires once a day. Slower than the old 4s cursor poll
// because it is no longer the primary delivery path.
const POLL_MS = 30_000;
const HOLD_MS = 7000;
const CHIME_SRC = "/sound/01-blushing-Emajor.wav";
// Realtime reconnect backoff: 1s → 2s → 4s … capped (SRS 1.4).
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const THAI_RE = /[\u0E00-\u0E7F]/;
const PETAL_PATH = "M8 0C3 2 0 7 0 12c0 4 3 7 8 9 5-2 8-5 8-9 0-5-3-10-8-12z";
const PETAL_COLORS = ["#e8a0b4", "#c76f89", "#f2c4ce", "#e7ae75", "#c5dea8"];

const CAFE_SVGS = [
  // Matcha latte
  `<svg viewBox="0 0 60 60" width="64" height="64" fill="none"><ellipse cx="30" cy="52" rx="16" ry="3" fill="rgb(74, 122, 42)"/><rect x="14" y="24" width="32" height="26" rx="6" fill="#7daa5a"/><rect x="16" y="22" width="28" height="6" rx="3" fill="#93ac78"/><ellipse cx="30" cy="22" rx="14" ry="4" fill="#b5cc94"/><path d="M22 32 Q30 28 38 32" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M20 38 Q30 33 40 38" stroke="rgba(255,255,255,0.38)" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M46 30 Q50 30 50 35 Q50 40 46 40" stroke="#5a8a3a" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M25 16 Q26 12 25 8" stroke="#93ac78" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M30 14 Q32 10 30 6" stroke="#93ac78" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M35 16 Q36 12 35 8" stroke="#93ac78" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
  // Cake slice
  `<svg viewBox="0 0 60 60" width="64" height="64" fill="none"><ellipse cx="30" cy="53" rx="14" ry="2.5" fill="rgb(199, 111, 137)"/><path d="M12 50 L30 12 L48 50 Z" fill="#f2c4ce" stroke="#c76f89" stroke-width="1.5" stroke-linejoin="round"/><path d="M14.5 45 L45.5 45" stroke="rgba(255,255,255,0.8)" stroke-width="2"/><path d="M17.5 38 L42.5 38" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/><path d="M21 30 L39 30" stroke="rgba(255,255,255,0.5)" stroke-width="1.2"/><circle cx="30" cy="12" r="4" fill="#e7ae75" stroke="#c9904a" stroke-width="1"/><path d="M26 6 Q30 2 34 6" stroke="#c9904a" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="22" cy="43" r="2" fill="#e8a0b4"/><circle cx="30" cy="43" r="2" fill="#e8a0b4"/><circle cx="38" cy="43" r="2" fill="#e8a0b4"/></svg>`,
  // Bread
  `<svg viewBox="0 0 60 60" width="64" height="64" fill="none"><ellipse cx="30" cy="52" rx="16" ry="3" fill="rgb(160, 96, 64)"/><path d="M10 36 Q10 18 30 14 Q50 18 50 36 Q46 50 30 50 Q14 50 10 36Z" fill="#d4956a" stroke="#a06040" stroke-width="1.2"/><ellipse cx="30" cy="17" rx="11" ry="5" fill="#e8b080" stroke="#c07050" stroke-width="1"/><path d="M16 33 Q30 26 44 33" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M17 40 Q30 34 43 40" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
  // Iced coffee
  `<svg viewBox="0 0 60 60" width="64" height="64" fill="none"><ellipse cx="30" cy="53" rx="12" ry="2.5" fill="rgb(100, 60, 20)"/><path d="M18 20 L20 52 Q20 54 30 54 Q40 54 40 52 L42 20 Z" fill="rgba(180,120,60,0.9)" stroke="#a06828" stroke-width="1"/><path d="M16 20 Q30 16 44 20" stroke="#a06828" stroke-width="1.2" fill="none"/><rect x="22" y="25" width="16" height="10" rx="3" fill="rgba(255,255,255,0.22)"/><path d="M25 29 L35 29" stroke="rgba(255,255,255,0.6)" stroke-width="1"/><path d="M24 39 Q28 36 32 39 Q36 42 40 39" stroke="rgba(255,255,255,0.28)" stroke-width="1" fill="none"/><rect x="28" y="10" width="4" height="12" rx="2" fill="#c9904a"/><circle cx="30" cy="10" r="3.5" fill="#e7ae75" stroke="#c9904a"/></svg>`,
  // Parfait
  `<svg viewBox="0 0 60 60" width="64" height="64" fill="none"><ellipse cx="30" cy="53" rx="10" ry="2" fill="rgb(199, 111, 137)"/><path d="M20 24 L22 52 Q22 54 30 54 Q38 54 38 52 L40 24 Z" fill="rgba(255,248,235,0.88)" stroke="#e7ae75" stroke-width="1"/><ellipse cx="30" cy="24" rx="10" ry="4" fill="#f2c4ce" stroke="#c76f89" stroke-width="1"/><ellipse cx="30" cy="32" rx="9" ry="3" fill="#c5dea8" opacity="0.9"/><ellipse cx="30" cy="40" rx="9" ry="3" fill="#f2c4ce" opacity="0.9"/><ellipse cx="30" cy="47" rx="8" ry="3" fill="#e7ae75" opacity="0.9"/><path d="M27 14 Q30 7 33 14" stroke="#c76f89" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="30" cy="13" r="3" fill="#e8a0b4" stroke="#c76f89"/><circle cx="24" cy="28" r="1.5" fill="rgba(255,255,255,0.7)"/><circle cx="36" cy="36" r="1.5" fill="rgba(255,255,255,0.7)"/></svg>`,
];

function playSound(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const audio = new Audio(src);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

function speak(text: string, token: string): Promise<void> {
  if (!text || typeof window === "undefined") return Promise.resolve();
  const safe = text.slice(0, 180);
  const lang = THAI_RE.test(safe) ? "th" : "en";
  const url = `/api/tts?text=${encodeURIComponent(safe)}&lang=${lang}&token=${encodeURIComponent(token)}`;
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Widget config, read from the OBS Browser Source URL ────────────────────
// Lets the streamer retune the overlay without a redeploy. Everything here is
// presentation-only; nothing config can say will hide a tip from the dashboard.
type WidgetConfig = {
  holdMs: number;
  sound: boolean;
  minAmount: Partial<Record<Currency, number>>; // major units, per currency
  ttsMin: Partial<Record<Currency, number>>;
  showTests: boolean;
};

const DEFAULT_CONFIG: WidgetConfig = {
  holdMs: HOLD_MS,
  sound: true,
  minAmount: {},
  ttsMin: {},
  showTests: false,
};

// Accepts either a bare number — applied to THB, the home currency — or an
// explicit per-currency list like "thb:100,usd:3,jpy:300". A bare number can't
// sensibly mean "100" in every currency at once ($100 would mute nearly every
// card tip), so the shorthand deliberately stays THB-only.
function parseThresholds(raw: string | null): Partial<Record<Currency, number>> {
  if (!raw) return {};
  const out: Partial<Record<Currency, number>> = {};
  if (/^\d+(\.\d+)?$/.test(raw.trim())) {
    out.thb = Number(raw);
    return out;
  }
  for (const part of raw.split(",")) {
    const [cur, val] = part.split(":").map((s) => s.trim().toLowerCase());
    const n = Number(val);
    if (isCurrency(cur) && Number.isFinite(n) && n >= 0) out[cur] = n;
  }
  return out;
}

function parseConfig(search: string): WidgetConfig {
  const p = new URLSearchParams(search);
  const holdRaw = Number(p.get("holdMs"));
  return {
    // Clamped: a zero or negative hold makes alerts unreadable, and an
    // unbounded one wedges the queue behind a single tip.
    holdMs: Number.isFinite(holdRaw) && holdRaw > 0 ? Math.min(Math.max(holdRaw, 1000), 60000) : HOLD_MS,
    sound: p.get("sound") !== "0" && p.get("sound") !== "off",
    minAmount: parseThresholds(p.get("minAmount")),
    ttsMin: parseThresholds(p.get("ttsMin")),
    // Off unless asked for: these fire a fully-formed fake alert, and the
    // source sits live in OBS where a stray click lands on stream. Add
    // `&test=1` while positioning the source, then drop it.
    showTests: p.get("test") === "1",
  };
}

// Below-threshold means "don't announce"; an absent threshold means announce.
function meetsThreshold(
  thresholds: Partial<Record<Currency, number>>,
  amountMinor: number,
  currency: Currency
): boolean {
  const min = thresholds[currency];
  if (min === undefined) return true;
  return fromMinorUnits(amountMinor, currency) >= min;
}

function randomCafeSvg() {
  return CAFE_SVGS[Math.floor(Math.random() * CAFE_SVGS.length)];
}

const CSS = `
  /* Fonts come from the root layout's next/font variables (--font-display /
     --font-body); no @import, so OBS never blocks the overlay on a Google
     Fonts request. */

  html, body { background: transparent !important; margin: 0; padding: 0; }

  /* ── Alert wrapper ── */
  .alert-wrap {
    display: flex; flex-direction: column; align-items: center;
    gap: 10px;
  }

  /* ── Pill ── */
  .username-pill {
    display: flex; align-items: baseline; gap: 6px;
    padding: 9px 22px; border-radius: 999px;
    max-width: 480px;
    background: rgba(255, 252, 254, 0.6);
    backdrop-filter: blur(16px) saturate(1.2);
    -webkit-backdrop-filter: blur(16px) saturate(1.2);
    border: 2px solid rgba(255, 254, 254, 0.92);
    box-shadow: 0 4px 20px rgba(0,0,0,0.55), 0 0 18px rgba(199,111,137,0.25), inset 0 1px 0 rgba(255,200,220,0.12);
    animation: pill-in 0.4s ease 0.32s both;
  }
  .from-text {
    font-family: var(--font-display);
    font-size: 13px; font-weight: 600;
    color: rgb(255, 255, 255);
    letter-spacing: 0.02em;
  }
  .from-name {
    font-family: var(--font-display);
    font-size: 16px; font-weight: 700;
    color: #ff4479;
    text-shadow: 0 0 14px rgba(252, 243, 245, 0.7), 0 1px 4px rgba(247, 228, 238, 0.7);
  }

  /* ── Main card ── */
  .main-card {
    display: flex; align-items: center; gap: 16px;
    padding: 16px 20px; border-radius: 22px;
    max-width: 480px;
    background: rgba(244, 183, 208, 0.64);
    backdrop-filter: blur(24px) saturate(1.3);
    -webkit-backdrop-filter: blur(24px) saturate(1.3);
    border: 2px solid rgba(220, 140, 165, 0.55);
    box-shadow:
      0 0 0 1px rgba(255,180,200,0.08),
      0 8px 32px rgba(0,0,0,0.6),
      0 0 28px rgba(199,111,137,0.2),
      inset 0 1px 0 rgba(255,200,220,0.10);
    animation: card-in 0.4s ease 0.46s both;
  }

  /* ── Flower image ── */
  .flower-container {
    position: relative; flex-shrink: 0;
    width: 90px; height: 90px;
    filter: drop-shadow(0 0 8px rgba(232,160,180,0.9)) drop-shadow(0 0 3px rgba(199,111,137,0.6));
  }
  .flower-img {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255, 199, 223, 0.5);
    clip-path: url(#flower-clip);
    animation: img-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.28s both;
  }

  /* ── Inner content box ── */
  .inner-box {
    flex: 1;
    background: rgba(112, 32, 61, 0.38);
    border: 1px solid rgba(220,140,165,0.22);
    border-radius: 14px; padding: 11px 15px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .amount-row { display: flex; align-items: center; gap: 8px; }
  .piggy-icon {
    width: 22px; height: 22px; flex-shrink: 0;
    color: #f2c4ce;
    filter: drop-shadow(0 0 6px rgba(199,111,137,0.7));
  }
  .amount-text {
    font-family: var(--font-display);
    font-size: 18px; font-weight: 700; line-height: 1; color: #f2c4ce;
    filter: drop-shadow(0 2px 8px rgba(199,111,137,0.55));
  }
  .amount-unit {
    font-family: var(--font-display);
    font-size: 13px; font-weight: 600; color: #f2c4ce;
    margin-left: 2px; align-self: flex-end; padding-bottom: 3px;
  }
  .tip-message {
    font-size: 14px; line-height: 1.6; color: rgb(255, 255, 255);
    font-family: var(--font-body); font-weight: 400;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  /* ── Petals ── */
  .petal { position: fixed; pointer-events: none; opacity: 0; animation: petal-drift linear forwards; }

  /* ── Animations ── */
  @keyframes wrap-enter {
    0%   { opacity:0; transform:translateY(52px) scale(0.92); }
    55%  { opacity:1; transform:translateY(-8px) scale(1.02); }
    78%  { transform:translateY(3px) scale(0.998); }
    90%  { transform:translateY(-1px); }
    100% { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes wrap-exit {
    0%  { opacity:1; transform:translateY(0) scale(1); }
    20% { transform:translateY(-6px) scale(1.01); }
    100%{ opacity:0; transform:translateY(44px) scale(0.9); }
  }
  @keyframes pill-in { from{opacity:0;transform:translateY(-6px);} to{opacity:1;transform:none;} }
  @keyframes card-in { from{opacity:0;transform:translateY(6px);}  to{opacity:1;transform:none;} }
  @keyframes img-pop { 0%{opacity:0;transform:scale(0.4) rotate(-10deg);} 65%{transform:scale(1.12) rotate(2deg);} 100%{opacity:1;transform:scale(1) rotate(0deg);} }
  @keyframes petal-drift {
    0%  { opacity:0;    transform:translate(0,0) rotate(0deg) scale(1); }
    8%  { opacity:0.75; }
    90% { opacity:0.4;  }
    100%{ opacity:0;    transform:translate(var(--tx),var(--ty)) rotate(var(--tr)) scale(0.65); }
  }
`;

export default function AlertWidget() {
  const [current, setCurrent] = useState<Alert | null>(null);
  const [cafeSvg, setCafeSvg] = useState(CAFE_SVGS[0]);
  const [animKey, setAnimKey] = useState(0);
  // Mirrors configRef.showTests. A ref alone wouldn't re-render the test panel,
  // which paints before the config-reading effect runs.
  const [showTests, setShowTests] = useState(false);
  // The widget's one real precondition, and the gate for both delivery effects
  // below. Three states, and the difference between the last two matters:
  //   null — the URL hasn't been read yet (SSR and the first paint)
  //   ""   — read, but there is no ?token= to work with
  //   …    — ready
  // There used to be an `unlocked`/`live` pair here instead, set by a two-click
  // setup overlay. That overlay meant an OBS source which reloaded mid-stream
  // came back silent and stayed silent — and since the poll below is also what
  // drives /api/sweep, it took reconciliation tier 3 down with it. OBS's
  // Chromium runs with autoplay allowed, so the gesture bought nothing here.
  const [token, setToken] = useState<string | null>(null);

  const queueRef = useRef<Alert[]>([]);
  // In-session guard only. Realtime and the reconciliation poll can both
  // deliver the same tip in the window before its ack lands, and this stops it
  // being queued twice. It is NOT what prevents replay across reloads — that is
  // alert_played_at in the database, set via /api/alerts/ack. Losing this Set on
  // reload is now harmless, which is exactly the bug that used to exist.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const playingRef = useRef(false);
  const tokenRef = useRef<string>("");
  const configRef = useRef<WidgetConfig>(DEFAULT_CONFIG);

  // ack/playNext/enqueue/poll are declared here, in dependency order (each
  // only calls things already declared above it), ahead of the effects below
  // that call enqueue/poll directly — so those calls are ordinary in-scope
  // references rather than forward references to a not-yet-declared binding.

  // Marks a tip as announced. Until this lands the row stays unplayed, so a
  // crash mid-animation replays it rather than losing it — the deliberate
  // direction to fail in.
  async function ack(id: string) {
    if (id.startsWith("test-")) return; // fake alerts have no row
    try {
      await fetch(`/api/alerts/ack?token=${encodeURIComponent(tokenRef.current)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch (err) {
      console.error("ack failed", err);
    }
  }

  async function playNext() {
    const next = queueRef.current.shift();
    if (!next) { playingRef.current = false; return; }
    const cfg = configRef.current;
    const cur = isCurrency(next.currency) ? next.currency : "thb";

    // Under the announce threshold: drop it and move straight on, without
    // taking the playing lock, so a run of small tips can't stall the queue.
    // Still acked — the streamer chose not to show it, so it is handled, and
    // leaving it unplayed would make every future poll re-deliver it forever.
    //
    // Replays are exempt. minAmount is a standing "don't bother me" rule for
    // tips arriving on their own; someone clicking Replay on this exact row has
    // just overruled it, and silently dropping the click would look like a
    // broken button with nothing on screen to explain it.
    if (!next.replay && !meetsThreshold(cfg.minAmount, next.amountMinor, cur)) {
      void ack(next.id);
      playNext();
      return;
    }

    playingRef.current = true;
    setCafeSvg(randomCafeSvg());
    setAnimKey((k) => k + 1);
    setCurrent(next);
    const isThai = THAI_RE.test(next.name) || THAI_RE.test(next.message ?? "");
    const spoken = isThai
      ? `${next.name} ป้อนอาหารน้องแน ${spokenAmount(next.amountMinor, cur, "th")} ${next.message ?? ""}`.trim()
      : `${next.name} tipped ${spokenAmount(next.amountMinor, cur, "en")}. ${next.message}`.trim();
    if (cfg.sound) await playSound(CHIME_SRC);
    // ttsMin is bypassed on a replay for the same reason as minAmount, and one
    // more: replay exists because you want to *hear* a tip again, so a replay
    // that renders a silent card would miss the point entirely.
    if (next.replay || meetsThreshold(cfg.ttsMin, next.amountMinor, cur)) await speak(spoken, tokenRef.current);
    await wait(cfg.holdMs);
    // Acked only now that it has fully played. Doing it on display would mean a
    // mid-animation crash silently swallowed someone's tip.
    //
    // Not on a replay: the row was acked the first time round and the replay
    // route never cleared it, so there is nothing to stamp. Skipping the call
    // also keeps alert_played_at honest as "when this tip first played".
    if (!next.replay) void ack(next.id);
    setCurrent(null);
    await wait(600);
    playNext();
  }

  function enqueue(alert: Alert) {
    if (!alert?.id) return;
    // An admin replay is the one case where re-delivering an id we have already
    // played is the whole point, so it skips the guard — and stays out of the
    // Set, which keeps that Set meaning exactly "ids seen through the normal
    // delivery path" and leaves it able to do its real job on the next tip.
    if (!alert.replay) {
      if (seenIdsRef.current.has(alert.id)) return;
      seenIdsRef.current.add(alert.id);
    }
    queueRef.current.push(alert);
    if (!playingRef.current) playNext();
  }

  async function poll() {
    try {
      // No cursor. The server returns every succeeded, visible tip that has not
      // been acked, so "what still needs announcing" is a database fact rather
      // than something this browser has to remember across reloads.
      const res = await fetch(`/api/recent-alerts?token=${encodeURIComponent(tokenRef.current)}`);
      if (!res.ok) return;
      const data = await res.json();
      for (const alert of (data.alerts ?? []) as Alert[]) enqueue(alert);
    } catch (err) {
      console.error("alert poll failed", err);
    }

    // Tier 3 of reconciliation: on Vercel Hobby, cron only fires daily, so the
    // widget being open is what gives PENDING→EXPIRED and late-webhook recovery
    // their 30-second cadence while you are actually live. The endpoint
    // throttles itself server-side, so calling it every poll is safe.
    try {
      await fetch(`/api/sweep?token=${encodeURIComponent(tokenRef.current)}`, { method: "POST" });
    } catch {
      /* sweep is best-effort; the daily cron is the floor */
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    tokenRef.current = params.get("token") || "";
    configRef.current = parseConfig(window.location.search);
    setShowTests(configRef.current.showTests);
    setToken(tokenRef.current);
  }, []);

  // ── Realtime: the fast path ──────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let backoff = BACKOFF_START_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;

    function connect() {
      if (cancelled) return;
      const client = supabaseBrowser();
      channel = client
        .channel(channelName(tokenRef.current), { config: { broadcast: { self: false } } })
        .on("broadcast", { event: ALERT_EVENT }, ({ payload }: { payload: Alert }) => {
          enqueue(payload);
        })
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            backoff = BACKOFF_START_MS; // healthy again
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // Broadcast does not replay missed messages, so a dropped socket is
            // a hole in delivery until we are back. Reconnect with the SRS's
            // 1s → 2s → 4s … capped-at-30s backoff; the reconciliation poll
            // below covers whatever landed while we were away.
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
              if (channel) client.removeChannel(channel);
              connect();
            }, backoff);
          }
        });
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabaseBrowser().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Reconciliation poll: the safety net, and the sweep driver ────────────
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(poll, POLL_MS);
    poll();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function testAlert(name: string, amountMinor: number, currency: Currency, message: string) {
    enqueue({ id: `test-${Date.now()}`, createdAt: Math.floor(Date.now() / 1000), name, message, amountMinor, currency });
  }

  function spawnPetals(cx: number, cy: number) {
    for (let i = 0; i < 9; i++) {
      setTimeout(() => {
        const p = document.createElement("div");
        p.className = "petal";
        const sz  = 8 + Math.random() * 10;
        const tx  = (Math.random() - 0.5) * 240;
        const ty  = -(50 + Math.random() * 160);
        const tr  = (Math.random() - 0.5) * 560 + "deg";
        const dur = 1.7 + Math.random() * 1.5;
        const col = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
        p.style.cssText = `left:${cx + (Math.random()-0.5)*110}px;top:${cy - Math.random()*40}px;--tx:${tx}px;--ty:${ty}px;--tr:${tr};animation-duration:${dur}s;`;
        p.innerHTML = `<svg width="${sz}" height="${sz}" viewBox="0 0 16 21" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4))"><path d="${PETAL_PATH}" fill="${col}"/></svg>`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), dur * 1000 + 200);
      }, i * 100 + Math.random() * 70);
    }
  }

  useEffect(() => {
    if (!current) return;
    setTimeout(() => {
      const el = document.getElementById("flower-img");
      if (el) {
        const r = el.getBoundingClientRect();
        spawnPetals(r.left + r.width / 2, r.top + r.height / 2);
      }
    }, 220);
  }, [current]);

  const setupBtnStyle: React.CSSProperties = {
    fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12,
    background: "rgba(255,248,243,0.2)", color: "#fff",
    border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999,
    padding: "8px 14px", cursor: "pointer",
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* 6-circle merged flower clipPath */}
      <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <defs>
          <clipPath id="flower-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.500" cy="0.285" r="0.258"/>
            <circle cx="0.686" cy="0.393" r="0.258"/>
            <circle cx="0.686" cy="0.607" r="0.258"/>
            <circle cx="0.500" cy="0.715" r="0.258"/>
            <circle cx="0.314" cy="0.607" r="0.258"/>
            <circle cx="0.314" cy="0.393" r="0.258"/>
            <circle cx="0.500" cy="0.500" r="0.200"/>
          </clipPath>
        </defs>
      </svg>

      {/* ── Test panel ── Only renders with &test=1 AND a real token; the default
          OBS URL never paints this and needs no interaction, and a tokenless
          load shows only the missing-token notice below instead of buttons
          whose /api/tts call would 401. Top-left, well clear of the
          bottom-centre alert. */}
      {showTests && token !== "" && (
        <div style={{
          position: "fixed", top: 12, left: 12, zIndex: 100,
          display: "flex", gap: 8,
          fontFamily: "var(--font-display)",
        }}>
          <button onClick={() => testAlert("Hikari", 500, "usd", "Love the cozy vibes 🌸")} style={setupBtnStyle}>
            ☕ Test $
          </button>
          <button onClick={() => testAlert("แนนนี่", 30000, "thb", "สู้ๆนะคะ เป็นกำลังใจให้เสมอ!")} style={setupBtnStyle}>
            🍵 Test ฿
          </button>
          <button onClick={() => testAlert("ดาบสุดหล่อ", 500, "jpy", "ข้อความทดสอบยาวๆ เพื่อดูว่าการ์ดตัดบรรทัดถูกต้องไหม")} style={setupBtnStyle}>
            📝 Test ¥
          </button>
        </div>
      )}

      {/* ── Missing-token notice ── token === "" means the URL was read and had
          no ?token=, as opposed to null (not read yet). Using the strict check
          keeps this from flashing on every normal, correctly-tokened load. */}
      {token === "" && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent",
          fontFamily: "var(--font-display)",
        }}>
          <div style={{
            background: "rgba(250,214,211,0.18)", backdropFilter: "blur(28px)",
            border: "1px solid rgba(255,255,255,0.25)", borderRadius: 20,
            padding: "20px 26px", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 8, textAlign: "center", maxWidth: 300,
            boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
          }}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: 0 }}>
              {BRAND_NAME}
            </p>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>
              Missing ?token= in the Browser Source URL
            </p>
          </div>
        </div>
      )}

      {/* ── Alert ── */}
      <div style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        paddingBottom: 44, pointerEvents: "none",
      }}>
        {current && (
          <div className="alert-wrap" key={animKey} style={{ animation: "wrap-enter 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
            {/* pill */}
            <div className="username-pill">
              <span className="from-text">Tipped From ✦</span>
              <span className="from-name">{current.name}</span>
            </div>

            {/* main card */}
            <div className="main-card">
              <div className="flower-container">
                <div className="flower-img" id="flower-img" dangerouslySetInnerHTML={{ __html: cafeSvg }} />
              </div>
              <div className="inner-box">
                <div className="amount-row">
                  <svg className="piggy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2h0z"/>
                    <path d="M2 9v1a2 2 0 0 0 2 2h1"/>
                    <path d="M16 11h0"/>
                  </svg>
                  <span className="amount-text">
                    {formatMoney(current.amountMinor, isCurrency(current.currency) ? current.currency : "thb")}
                  </span>
                  <span className="amount-unit">
                    {
                      CURRENCIES[isCurrency(current.currency) ? current.currency : "thb"].spoken[
                        // Match the unit word to the tip's own language, the
                        // same way the TTS line does — a Thai tip read as
                        // "บาท" aloud shouldn't render "baht" on the card.
                        THAI_RE.test(current.name) || THAI_RE.test(current.message ?? "") ? "th" : "en"
                      ]
                    }
                  </span>
                </div>
                {current.message && <p className="tip-message">{current.message}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
