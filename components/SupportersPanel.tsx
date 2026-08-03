"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { translations, type Lang } from "@/lib/i18n";
import { formatMoney, isCurrency, type Currency } from "@/lib/money";
import SupporterAvatar from "./SupporterAvatar";

type Timeframe = "week" | "month" | "90d" | "year" | "all";
const TIMEFRAMES: Timeframe[] = ["week", "month", "90d", "year", "all"];

type TopEntry = { displayName: string; rank: number };
type RecentEntry = { name: string; amountMinor: number; currency: string; createdAt: string };
type SupportersData = { count: number; timeframe: Timeframe; top: TopEntry[]; recent: RecentEntry[] };

export type SupportersPanelHandle = { refresh: () => void };
export type SupportersPanelProps = { lang: Lang };

// CSS `order` puts rank 1 visually in the center of the podium (larger avatar)
// while the DOM itself stays rank-ordered — no bespoke position-per-rank markup.
const PODIUM_ORDER: Record<number, number> = { 1: 2, 2: 1, 3: 3 };

function isAnonymousName(name: string): boolean {
  const trimmed = name.trim();
  return !trimmed || trimmed.toLowerCase() === "anonymous";
}

const SupportersPanel = forwardRef<SupportersPanelHandle, SupportersPanelProps>(function SupportersPanel(
  { lang },
  ref
) {
  const t = translations[lang];
  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [data, setData] = useState<SupportersData | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Monotonic request id: a response is applied only if no newer request has
  // started since. Without it, switching timeframes quickly (or a refresh
  // retry landing after a switch) can resolve out of order and render data for
  // the wrong period.
  const reqSeq = useRef(0);
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearRetries() {
    retryTimers.current.forEach(clearTimeout);
    retryTimers.current = [];
  }

  const load = useCallback(async (tf: Timeframe, fresh = false) => {
    const seq = ++reqSeq.current;
    try {
      // `fresh` bypasses the route's in-memory cache and its s-maxage CDN
      // entry; the timestamp defeats the browser's own cache. Used only on the
      // post-tip refresh — the mount/switch path stays cheap and cacheable.
      const url = fresh
        ? `/api/supporters?timeframe=${tf}&fresh=1&t=${Date.now()}`
        : `/api/supporters?timeframe=${tf}`;
      const res = await fetch(url, fresh ? { cache: "no-store" } : undefined);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as SupportersData;
      if (seq !== reqSeq.current) return;
      setData(json);
      setLoadError(false);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      console.error("Failed to load supporters", err);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    clearRetries();
    load(timeframe);
  }, [load, timeframe]);

  useEffect(() => clearRetries, []);

  // Exposed so app/page.tsx can refetch the moment the visitor's own tip
  // succeeds, without the panel needing to know why.
  //
  // Fires three times on purpose. The card flow reaches "success" on
  // client-side Stripe confirmation, which can beat the webhook that actually
  // promotes the order to SUCCESS in our DB — so an immediate read may not see
  // the tip yet. Bounded and event-triggered, not the steady-state polling the
  // plan rules out.
  const refresh = useCallback(() => {
    clearRetries();
    load(timeframe, true);
    retryTimers.current = [
      setTimeout(() => load(timeframe, true), 2500),
      setTimeout(() => load(timeframe, true), 7000),
    ];
  }, [load, timeframe]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const timeframeLabel: Record<Timeframe, string> = {
    week: t.timeframeWeek,
    month: t.timeframeMonth,
    "90d": t.timeframe90d,
    year: t.timeframeYear,
    all: t.timeframeAll,
  };

  return (
    <aside className="supporters-panel">
      {/* Non-breaking space rather than `?? 0` while loading — holding the
          line's height is harmless, but rendering "0 Supporters" for a beat
          states something untrue. */}
      <div className="supporters-count">{data ? t.supportersCount(data.count) : " "}</div>

      {loadError && <div className="supporters-empty">{t.supportersLoadError}</div>}

      <div className="supporters-top">
        <div className="supporters-title">{t.supportersTopTitle}</div>
        <div className="timeframe-switcher">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={tf === timeframe ? "active" : ""}
              onClick={() => setTimeframe(tf)}
            >
              {timeframeLabel[tf]}
            </button>
          ))}
        </div>

        {data && data.top.length === 0 && !loadError && <div className="supporters-empty">{t.supportersEmptyTop}</div>}

        {data && data.top.length > 0 && (
          <div className="podium">
            {data.top.map((entry) => (
              <div key={entry.rank} className="podium-slot" style={{ order: PODIUM_ORDER[entry.rank] ?? entry.rank }}>
                <div className="podium-rank">#{entry.rank}</div>
                <SupporterAvatar name={entry.displayName} size={entry.rank === 1 ? 56 : 44} />
                <div className="podium-name">{entry.displayName}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="supporters-recent">
        <div className="supporters-title">{t.supportersRecentTitle}</div>
        {data && data.recent.length === 0 && !loadError && (
          <div className="supporters-empty">{t.supportersEmptyRecent}</div>
        )}
        <ul className="recent-list">
          {data?.recent.map((entry, i) => {
            const anon = isAnonymousName(entry.name);
            const displayName = anon ? t.anonymousLabel : entry.name;
            const currency: Currency = isCurrency(entry.currency) ? entry.currency : "thb";
            const money = formatMoney(entry.amountMinor, currency);
            return (
              <li key={`${entry.createdAt}-${i}`} className="recent-row">
                <SupporterAvatar name={entry.name} size={32} />
                <span className="recent-phrase">{t.tippedPhrase(displayName, money)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
});

export default SupportersPanel;
