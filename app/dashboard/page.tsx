"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, isCurrency } from "@/lib/money";
import { dashboardTranslations, isLang, type Lang } from "@/lib/i18n";
import { BRAND_NAME } from "@/lib/brand";
import { supabaseBrowser } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";

type Txn = {
  id: string;
  createdAt: number;
  name: string;
  message: string;
  amountMinor: number;
  currency: string;
  showOnScreen: boolean;
  status: string;
  // NULL means "never announced on stream" — the row is still in the widget's
  // pending-alerts feed and will play on its own. That is why Replay is only
  // offered once this is set: replaying a tip that is still queued would
  // announce it twice.
  alertPlayedAt: string | null;
};

// Display a transaction's amount in its own currency (older THB-only records
// have currency "thb" and render exactly as before).
function displayAmount(t: Txn): string {
  const cur = isCurrency(t.currency) ? t.currency : "thb";
  return formatMoney(t.amountMinor, cur);
}

// Statuses are now our own four-state machine, not Stripe's strings.
function statusTone(status: string): "ok" | "pending" | "muted" {
  if (status === "SUCCESS") return "ok";
  if (status === "PENDING") return "pending";
  return "muted"; // EXPIRED, FAILED
}

const CSS = `
  .dash-page {
    position: relative; z-index: 1;
    width: 100%; max-width: 980px;
    display: flex; flex-direction: column; gap: 20px;
  }
  .dash-head { text-align: center; }
  .dash-card { padding: 22px 20px; overflow: hidden; }
  .table-scroll { width: 100%; overflow-x: auto; }
  table.txns {
    width: 100%; border-collapse: collapse;
    font-family: var(--font-body); font-size: 13.5px; color: var(--text);
  }
  table.txns th {
    text-align: left; font-family: var(--font-display); font-weight: 700;
    font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--sakura-deep); padding: 10px 12px; white-space: nowrap;
    border-bottom: 1.5px solid var(--border);
  }
  table.txns td {
    padding: 11px 12px; border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  table.txns tr:last-child td { border-bottom: none; }
  .col-time { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
  .col-name { font-weight: 600; }
  .col-amount { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .col-msg { max-width: 340px; overflow-wrap: anywhere; line-height: 1.5; }
  .col-msg.empty { color: var(--muted); }
  .flag { font-size: 15px; }
  .flag.on { color: var(--matcha); }
  .flag.off { color: var(--muted); }
  .pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-family: var(--font-display); font-weight: 700; font-size: 11px;
    white-space: nowrap;
  }
  .pill.ok { background: rgba(147,172,120,0.2); color: #5f7d3f; }
  .pill.pending { background: rgba(231,174,117,0.25); color: #a5702a; }
  .pill.muted { background: rgba(171,141,131,0.18); color: var(--muted); }
  [data-theme="dark"] .pill.ok { background: rgba(147,172,120,0.16); color: #a9c48d; }
  [data-theme="dark"] .pill.pending { background: rgba(231,174,117,0.18); color: #e0b06a; }
  .load-more { max-width: 220px; margin: 4px auto 0; }
  .state-msg { text-align: center; color: var(--muted); padding: 20px 0; }

  .dash-toolbar {
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  }
  .dash-search { flex: 1 1 220px; min-width: 0; }
  .dash-filter {
    font-family: var(--font-body); font-size: 13px;
    padding: 9px 12px; border-radius: 12px;
    border: 1px solid var(--border); background: var(--surface); color: var(--text);
  }

  /* Top-right cluster: language toggle + sign out, sitting on the same line.
     .lang-toggle is fixed by default in globals.css, so it is unpinned here
     and the wrapper takes over the positioning. */
  .dash-topright {
    position: fixed; top: 16px; right: 16px; z-index: 2;
    display: flex; align-items: center; gap: 8px;
  }
  .dash-topright .lang-toggle { position: static; top: auto; right: auto; z-index: auto; }
  .dash-signout {
    font-family: var(--font-display); font-weight: 600; font-size: 12px;
    padding: 9px 14px; border-radius: 999px; width: auto;
    border: 1px solid var(--border); background: var(--surface); color: var(--muted);
    box-shadow: 0 6px 16px rgba(199, 111, 137, 0.18);
    cursor: pointer;
  }
  [data-theme="dark"] .dash-signout { box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4); }
  .dash-signout:hover { border-color: var(--sakura-deep); color: var(--sakura-deep); }
  .override-btn, .replay-btn {
    font-family: var(--font-display); font-weight: 700; font-size: 11px;
    padding: 5px 11px; border-radius: 999px; white-space: nowrap;
    border: 1px solid var(--border); background: transparent; color: var(--sakura-deep);
    cursor: pointer;
  }
  .override-btn:hover:not(:disabled),
  .replay-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--sakura-deep); }
  .override-btn:disabled { opacity: 0.5; cursor: default; }
  /* The cooldown state reads as a confirmation, not as a greyed-out button —
     it is telling you the broadcast went out, not that the row is unavailable. */
  .replay-btn:disabled { cursor: default; }
  .replay-btn.sending { opacity: 0.5; }
  .replay-btn.sent { color: var(--matcha); border-color: var(--matcha); opacity: 1; }
`;

export default function Dashboard() {
  const [lang, setLang] = useState<Lang>("th");
  const t = dashboardTranslations[lang];
  const [txns, setTxns] = useState<Txn[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error" | "empty">(
    "loading"
  );
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // B1 filters. Both are server-side WHERE clauses now, so they search the whole
  // table rather than only the rows already paged in.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [overriding, setOverriding] = useState<string | null>(null);
  // One row at a time: the widget plays alerts serially, so there is never a
  // reason to have two replays in flight.
  const [replay, setReplayState] = useState<{ id: string; phase: "sending" | "sent" } | null>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // One-time correction from the URL (a browser-only source), not derived
    // state — must run post-mount rather than in a lazy initializer so SSR
    // and the first paint stay in sync before this client-only override lands.
    const urlLang = new URLSearchParams(window.location.search).get("lang");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isLang(urlLang)) setLang(urlLang);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // The cooldown timer outlives the click, so it has to be cancelled on unmount
  // or it fires setState on a dead component.
  useEffect(() => {
    return () => {
      if (replayTimer.current) clearTimeout(replayTimer.current);
    };
  }, []);

  // Refetch when a filter changes, debounced so typing doesn't fire a request
  // per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => load(null, false), search ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  async function load(before: string | null, append: boolean) {
    if (append) setLoadingMore(true);
    else setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const params = new URLSearchParams();
      if (before) params.set("before", before);
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());

      const res = await fetch(`/api/transactions?${params.toString()}`);
      // No session (or the wrong account): send them to sign in rather than
      // showing an empty table that looks like "you have no tips".
      if (res.status === 401 || res.status === 403) {
        setStatus("unauthorized");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      const rows = data.transactions as Txn[];
      setTxns((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
      setStatus(!append && rows.length === 0 ? "empty" : "ready");
    } catch (err) {
      console.error("Failed to load transactions", err);
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }

  // SRS 1.2 manual override. Confirmed first because it replays the on-stream
  // alert — a misclick is visible to every viewer.
  async function override(paymentIntentId: string) {
    if (!window.confirm(t.overrideConfirm)) return;
    setOverriding(paymentIntentId);
    try {
      const res = await fetch("/api/admin/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      if (!res.ok) {
        window.alert(t.overrideFailed);
        return;
      }
      await load(null, false);
    } catch (err) {
      console.error("Override failed", err);
      window.alert(t.overrideFailed);
    } finally {
      setOverriding(null);
    }
  }

  // Re-announce a tip that already played. Unlike override this writes nothing,
  // so there is no confirm dialog and no refetch afterwards — the row on screen
  // is still accurate.
  //
  // The cooldown is the guard instead: the alert itself runs for holdMs plus
  // chime plus TTS, and the widget queues them serially, so four quick clicks
  // would be forty seconds of alerts with no way to cancel. Five seconds of a
  // dead button is the cheapest way to make that impossible.
  async function sendReplay(paymentIntentId: string) {
    if (replay) return;
    if (replayTimer.current) clearTimeout(replayTimer.current);
    setReplayState({ id: paymentIntentId, phase: "sending" });
    try {
      const res = await fetch("/api/admin/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      if (!res.ok) {
        setReplayState(null);
        window.alert(t.replayFailed);
        return;
      }
      // "Sent" means the broadcast was published, not that anything played —
      // if OBS is closed there is nobody listening and we have no way to know.
      setReplayState({ id: paymentIntentId, phase: "sent" });
      replayTimer.current = setTimeout(() => setReplayState(null), 5000);
    } catch (err) {
      console.error("Replay failed", err);
      setReplayState(null);
      window.alert(t.replayFailed);
    }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <ThemeToggle />
      <div className="dash-page">
        <div className="dash-topright">
          <div className="lang-toggle">
            <button type="button" className={lang === "th" ? "active" : ""} onClick={() => setLang("th")}>
              ไทย
            </button>
            <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
              EN
            </button>
          </div>
          {status !== "unauthorized" && (
            <button type="button" className="dash-signout" onClick={signOut}>
              {t.signOut}
            </button>
          )}
        </div>

        <div className="dash-head">
          <p className="eyebrow">{BRAND_NAME}</p>
          <h1>{t.title}</h1>
          <p className="subtitle">{t.subtitle}</p>
        </div>

        {status !== "unauthorized" && (
          <div className="dash-toolbar">
            <input
              type="search"
              className="dash-search"
              placeholder={t.searchPlaceholder}
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="dash-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t.filterAll}</option>
              {(["SUCCESS", "PENDING", "EXPIRED", "FAILED"] as const).map((s) => (
                <option key={s} value={s}>
                  {t.statusLabels[s]}
                </option>
              ))}
            </select>
          </div>
        )}

        {status === "loading" && (
          <div className="card dash-card">
            <p className="state-msg">{t.loading}</p>
          </div>
        )}

        {status === "unauthorized" && (
          <div className="card dash-card">
            <p className="state-msg">{t.unauthorized}</p>
            <a className="load-more" href="/login" style={{ display: "block", textAlign: "center" }}>
              {t.signInLink}
            </a>
          </div>
        )}

        {status === "error" && (
          <div className="card dash-card">
            <p className="state-msg">{t.loadError}</p>
          </div>
        )}

        {status === "empty" && (
          <div className="card dash-card">
            <p className="state-msg">{t.empty}</p>
          </div>
        )}

        {status === "ready" && (
          <div className="card dash-card">
            <div className="table-scroll">
              <table className="txns">
                <thead>
                  <tr>
                    <th>{t.colTime}</th>
                    <th>{t.colName}</th>
                    <th>{t.colAmount}</th>
                    <th>{t.colMessage}</th>
                    <th>{t.colShowOnScreen}</th>
                    <th>{t.colStatus}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {txns.map((txn) => (
                    <tr key={txn.id}>
                      <td className="col-time">
                        {new Date(txn.createdAt * 1000).toLocaleString(lang === "th" ? "th-TH" : "en-GB")}
                      </td>
                      <td className="col-name">{txn.name}</td>
                      <td className="col-amount">{displayAmount(txn)}</td>
                      <td className={`col-msg${txn.message ? "" : " empty"}`}>
                        {txn.message || t.noMessage}
                      </td>
                      <td>
                        <span className={`flag ${txn.showOnScreen ? "on" : "off"}`}>
                          {txn.showOnScreen ? "✓" : "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${statusTone(txn.status)}`}>
                          {t.statusLabels[txn.status as keyof typeof t.statusLabels] ?? txn.status}
                        </span>
                      </td>
                      <td>
                        {/* Offered for anything that isn't already succeeded —
                            including EXPIRED and FAILED, which is the whole
                            point of a last-resort recovery tool. */}
                        {txn.status !== "SUCCESS" && (
                          <button
                            type="button"
                            className="override-btn"
                            disabled={overriding === txn.id}
                            onClick={() => override(txn.id)}
                          >
                            {t.overrideBtn}
                          </button>
                        )}
                        {/* The other half of the same column, and never shown
                            at the same time as the button above. Three
                            conditions, each ruling out a way to announce
                            something you shouldn't: not succeeded (the money
                            never arrived), hidden (the payer asked to stay off
                            screen), never played (still queued — replaying it
                            would announce it twice). The route re-checks the
                            first two; this only decides what to draw. */}
                        {txn.status === "SUCCESS" && txn.showOnScreen && txn.alertPlayedAt && (
                          <button
                            type="button"
                            className={`replay-btn${
                              replay?.id === txn.id ? ` ${replay.phase}` : ""
                            }`}
                            disabled={replay !== null}
                            onClick={() => sendReplay(txn.id)}
                          >
                            {replay?.id === txn.id && replay.phase === "sent"
                              ? t.replaySent
                              : t.replayBtn}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status === "ready" && hasMore && (
          <button
            className="load-more"
            disabled={loadingMore}
            onClick={() => load(cursor, true)}
          >
            {loadingMore ? t.loadingMore : t.loadMore}
          </button>
        )}
      </div>
    </>
  );
}
