"use client";

// A monitoring view, not a dashboard. The assumption behind every choice here is
// that it is sitting on a second monitor or a propped-up phone while the creator
// is playing a game and NOT looking at it — so it must be readable from a metre
// away in peripheral vision, it must never require a click to stay current, and
// it must be obvious at a glance whether it is still connected. A stale feed
// that looks healthy is the one genuinely harmful failure mode, so the
// connection state is rendered as prominently as the tips themselves.
//
// Deliberately NOT part of /dashboard: that page is for sitting down and
// reading, and its range picker, chart and pager are all noise here.
//
// EXPIRED orders are excluded end to end (query and merge). An expired PromptPay
// QR is someone who never paid — it is the single most common row in the table
// and it carries no message worth reading, so on a glanceable feed it is pure
// noise crowding out the rows that matter.

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney, isCurrency } from "@/lib/money";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { LIVE_EVENT, liveChannelName, type LivePayload } from "@/lib/live.shared";

// Realtime carries a tip within about a second. This poll is the safety net for
// a dropped websocket or a broadcast that never landed — the same belt-and-
// braces arrangement /alert uses, and the reason a missed broadcast costs
// freshness rather than a lost message.
const POLL_MS = 30_000;

// How long a row stays visually "new". Long enough to catch on a glance back
// from a game, short enough that the whole feed isn't lit up.
const HIGHLIGHT_MS = 60_000;

type Conn = "connecting" | "live" | "reconnecting" | "offline";

type Row = LivePayload & { seenAt: number; isNew: boolean };

// An expired QR is a payment that never happened. Filtered in both directions so
// neither the initial query nor a future broadcast can put one on screen.
function isNoise(p: LivePayload): boolean {
  return p.status === "EXPIRED";
}

function money(amountMinor: number, currency: string): string {
  return isCurrency(currency) ? formatMoney(amountMinor, currency) : String(amountMinor);
}

function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Relative for anything recent, absolute once it stops being "a moment ago".
// On a feed you glance at, "3m ago" answers the actual question ("did I miss
// this?") in a way a wall-clock time does not.
function relTime(unixSeconds: number, now: number): string {
  if (!now) return clockTime(unixSeconds); // pre-hydration tick
  const s = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return clockTime(unixSeconds);
}

// A tip "counts" for the chime and the highlight when it becomes SUCCESS —
// either arriving already succeeded, or crossing over from a state we'd seen.
function becameSuccess(prev: LivePayload | undefined, next: LivePayload): boolean {
  if (next.status !== "SUCCESS") return false;
  return !prev || prev.status !== "SUCCESS";
}

// Short, quiet, and synthesised rather than a file — this page must not ship an
// asset just to make a noise, and a soft two-note blip cuts through game audio
// without being startling.
function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    // No audio device, autoplay policy, anything — the visual highlight is the
    // primary signal and the chime is a bonus. Never let it break the feed.
  }
}

export default function LiveFeed() {
  const [rows, setRows] = useState<Row[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [sound, setSound] = useState(true);
  const [lastAt, setLastAt] = useState<number | null>(null);
  // The clock the highlight fade and relative times read. Held in state rather
  // than called during render so the row list stays a pure function of state
  // (and so SSR and the first client render agree); the ticker below advances it.
  const [now, setNow] = useState(0);

  const tokenRef = useRef<string>("");
  const soundRef = useRef(true);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // Fold payloads into the feed. Shared by the broadcast handler and the poll so
  // both paths dedupe, re-key and decide "is this new?" identically — the poll
  // re-delivers rows the socket already showed, and this is what stops that
  // double-chiming.
  //
  // `replace` makes a poll result authoritative rather than additive. Without it
  // a row can never LEAVE the feed, so one that quietly expired after we saw it
  // as PENDING would sit there forever showing a state it is no longer in.
  const merge = useCallback((incoming: LivePayload[], opts: { announce: boolean; replace?: boolean }) => {
    const fresh = incoming.filter((p) => !isNoise(p));
    setRows((prev) => {
      const known = new Map(prev.map((r) => [r.id, r]));
      const next = opts.replace ? new Map<string, Row>() : new Map(known);
      let chimed = false;

      for (const p of fresh) {
        const existing = known.get(p.id);
        // `announce` gates the highlight as well as the chime. Without it the
        // first load would mark every row "new" (each one is a first sighting of
        // a succeeded tip) and light the whole feed up — the exact opposite of a
        // view whose job is to make one arriving tip obvious.
        const isFresh = opts.announce && becameSuccess(existing, p);
        if (isFresh && !chimed && soundRef.current) {
          chime();
          chimed = true;
        }
        next.set(p.id, {
          ...p,
          seenAt: isFresh || !existing ? Date.now() : existing.seenAt,
          isNew: isFresh ? true : (existing?.isNew ?? false),
        });
      }

      return [...next.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    });
    setLastAt(Date.now());
  }, []);

  const load = useCallback(async (announce: boolean) => {
    try {
      const res = await fetch("/api/live/feed");
      if (res.status === 401 || res.status === 403) {
        setStatus("unauthorized");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = (await res.json()) as { token: string | null; orders: LivePayload[] };
      tokenRef.current = data.token ?? "";
      merge(data.orders ?? [], { announce, replace: true });
      setStatus("ready");
    } catch {
      // Network blip. Keep whatever is on screen — a monitoring view that blanks
      // itself the moment wifi hiccups is worse than one showing a stale row,
      // because the connection pill already says so.
      setConn((c) => (c === "live" ? "reconnecting" : c));
    }
  }, [merge]);

  // Initial load. `announce: false` — everything already on the table at open
  // time is history, not an arrival, and chiming through the last 50 tips on
  // page load would be a genuinely bad first impression.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
  }, [load]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready" || !tokenRef.current) return;

    const client = supabaseBrowser();
    let channel: ReturnType<typeof client.channel> | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      channel = client
        .channel(liveChannelName(tokenRef.current), { config: { broadcast: { self: false } } })
        .on("broadcast", { event: LIVE_EVENT }, (msg: { payload?: LivePayload }) => {
          if (msg.payload) merge([msg.payload], { announce: true });
        })
        .subscribe((s: string) => {
          if (cancelled) return;
          if (s === "SUBSCRIBED") {
            retry = 0;
            setConn("live");
            // Catch up on anything that landed while the socket was down. The
            // reconnect itself is the signal that a gap may exist.
            load(true);
            return;
          }
          if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            setConn("reconnecting");
            // 1s → 2s → 4s … capped at 30s, mirroring /alert. The poll keeps the
            // feed correct meanwhile, so backing off aggressively is safe.
            const delay = Math.min(30_000, 1000 * 2 ** retry);
            retry += 1;
            if (channel) client.removeChannel(channel);
            channel = null;
            retryTimer = setTimeout(connect, delay);
          }
        });
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) client.removeChannel(channel);
    };
  }, [status, merge, load]);

  // ── Reconciliation poll ────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "ready") return;
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [status, load]);

  // Re-render once a second so relative times and the highlight fade stay
  // truthful on a page that can sit untouched for hours. Seeded immediately so a
  // tip arriving in the first second still gets its highlight.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // A tab backgrounded behind a fullscreen game gets its timers throttled hard.
  // Refetching on the way back is what stops a returning glance seeing minutes
  // of staleness.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") load(true);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    function onOffline() { setConn("offline"); }
    function onOnline() { setConn("reconnecting"); load(true); }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  const held = rows.filter((r) => r.moderation === "held").length;

  // The tab title is part of the UI when this page lives in a background tab on
  // a second monitor — a held count there is visible without switching to it.
  useEffect(() => {
    document.title = held > 0 ? `(${held}) Live feed` : "Live feed";
  }, [held]);

  if (status === "unauthorized") {
    return (
      <main className="lf">
        <style>{CSS}</style>
        <div className="lf-empty">
          <p className="lf-empty-title">Sign in to watch the feed</p>
          <p className="lf-empty-hint">This page shows every tip as it arrives, including ones held for review.</p>
          <a className="lf-btn lf-btn-accent" href="/login">Go to sign-in</a>
        </div>
      </main>
    );
  }

  const connText: Record<Conn, string> = {
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    offline: "Offline",
  };

  return (
    <main className="lf">
      <style>{CSS}</style>

      <header className="lf-head">
        <div className="lf-head-row">
          <h1 className="lf-title">Live feed</h1>
          <span className={`lf-conn lf-conn-${conn}`} role="status" aria-live="polite">
            <span className="lf-dot" aria-hidden="true" />
            {connText[conn]}
          </span>
        </div>

        <div className="lf-head-row lf-actions">
          {held > 0 && (
            <a className="lf-btn lf-btn-warn" href="/settings">
              {held} held for review
            </a>
          )}
          <button
            type="button"
            className="lf-btn"
            onClick={() => setSound((s) => !s)}
            aria-pressed={sound}
            aria-label={sound ? "Chime on for new tips. Turn off." : "Chime off for new tips. Turn on."}
          >
            <SoundIcon on={sound} />
            {sound ? "Chime on" : "Chime off"}
          </button>
          <a className="lf-btn" href="/dashboard">Dashboard</a>
          <span className="lf-updated">
            {lastAt ? `Checked ${relTime(Math.floor(lastAt / 1000), now)}` : "Checking…"}
          </span>
        </div>
      </header>

      {status === "loading" ? (
        <ul className="lf-list" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="lf-card lf-skel">
              <span className="lf-skel-bar" style={{ width: "38%" }} />
              <span className="lf-skel-bar" style={{ width: "82%" }} />
            </li>
          ))}
        </ul>
      ) : status === "error" ? (
        <div className="lf-empty">
          <p className="lf-empty-title lf-danger">Could not load the feed</p>
          <p className="lf-empty-hint">The connection to the café failed. It will retry on its own.</p>
          <button type="button" className="lf-btn lf-btn-accent" onClick={() => load(false)}>Try again now</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="lf-empty">
          <p className="lf-empty-title">No tips yet</p>
          <p className="lf-empty-hint">Leave this open — new tips appear here on their own, no refresh needed.</p>
        </div>
      ) : (
        <ul className="lf-list" aria-live="polite" aria-relevant="additions">
          {rows.map((r) => {
            const fresh = r.isNew && now - r.seenAt < HIGHLIGHT_MS;
            const treat = r.itemEn || r.itemTh;
            return (
              <li key={r.id} className={`lf-card${fresh ? " is-new" : ""}${r.status === "SUCCESS" ? "" : " is-muted"}`}>
                <div className="lf-card-head">
                  <span className="lf-amount">{money(r.amountMinor, r.currency)}</span>
                  <span className="lf-name">{r.name}</span>
                  <time className="lf-time" dateTime={new Date(r.createdAt * 1000).toISOString()}>
                    {relTime(r.createdAt, now)}
                  </time>
                </div>

                {treat && <p className="lf-treat">{treat}</p>}

                {r.message && <p className="lf-message">{r.message}</p>}

                {(r.status !== "SUCCESS" || r.moderation !== "approved" || !r.showOnScreen || !r.alertPlayedAt) && (
                  <ul className="lf-tags">
                    {r.status !== "SUCCESS" && <Tag kind="neutral">{r.status === "PENDING" ? "Awaiting payment" : "Failed"}</Tag>}
                    {r.moderation === "held" && <Tag kind="warn">Held — needs a look</Tag>}
                    {r.moderation === "blocked" && <Tag kind="danger">Blocked</Tag>}
                    {!r.showOnScreen && <Tag kind="neutral">Hidden from overlay</Tag>}
                    {r.status === "SUCCESS" && r.moderation === "approved" && !r.alertPlayedAt && (
                      <Tag kind="info">Not played yet</Tag>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Tag({ kind, children }: { kind: "neutral" | "warn" | "danger" | "info"; children: React.ReactNode }) {
  return <li className={`lf-tag lf-tag-${kind}`}>{children}</li>;
}

// Inline SVG rather than an emoji or a glyph font: it inherits currentColor, so
// it stays legible in every state the button can be in, and it can't render as
// a tofu box on a machine missing the font.
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">
      <path d="M3 6h2l3-2.5v9L5 10H3z" />
      {on ? <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" /> : <path d="M10.5 6l4 4M14.5 6l-4 4" />}
    </svg>
  );
}

// Real CSS rather than inline styles, because the things that most needed fixing
// here — visible focus rings, hover/press feedback, and honouring
// prefers-reduced-motion — cannot be expressed as a style object at all.
//
// Dark-only on purpose: this sits next to a game at night far more often than it
// sits in a bright room, and a surprise white flash on a second monitor
// mid-session is exactly what a glanceable view must not do. Every pair below
// clears WCAG AA (4.5:1) against its own surface — the previous muted greys sat
// at 3.3–4.2:1 and were the main reason this was hard to read at a distance.
const CSS = `
.lf {
  --bg: #14100D;
  --surface: #201A15;
  --surface-hi: #2B231B;
  --border: #3D332A;
  --border-hi: #5A4838;
  --text: #F5EAD8;
  --muted: #B9A48A;
  --accent: #E0A75C;
  --live: #8FC97F;
  --warn: #D7A55B;
  --danger: #E4767D;
  --info: #93B0D8;
  --mono: var(--font-silkscreen), ui-monospace, monospace;
  --dot: var(--font-dotgothic), monospace;

  /* Dense/dashboard rhythm: 8px base, so more rows land above the fold. */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px;

  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  max-width: 780px;
  margin: 0 auto;
  padding:
    calc(var(--s3) + env(safe-area-inset-top))
    calc(var(--s4) + env(safe-area-inset-right))
    calc(var(--s5) + env(safe-area-inset-bottom))
    calc(var(--s4) + env(safe-area-inset-left));
  font-variant-numeric: tabular-nums;
}

/* ── header ─────────────────────────────────────────────────────────────── */
.lf-head {
  position: sticky; top: 0; z-index: 10;
  background: var(--bg);
  padding-bottom: var(--s3);
  margin-bottom: var(--s3);
  border-bottom: 3px solid var(--border);
}
.lf-head-row { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
.lf-actions { margin-top: var(--s2); }
.lf-title {
  font-family: var(--mono); font-size: 13px; letter-spacing: 1px;
  margin: 0; color: var(--text); text-transform: uppercase;
}
.lf-updated { font-family: var(--dot); font-size: 13px; color: var(--muted); margin-left: auto; }

.lf-conn {
  display: inline-flex; align-items: center; gap: var(--s2);
  font-family: var(--mono); font-size: 10px; letter-spacing: .5px;
  border: 2px solid currentColor; padding: 5px var(--s2);
  margin-left: auto;
}
.lf-conn-live { color: var(--live); }
.lf-conn-connecting, .lf-conn-reconnecting { color: var(--warn); }
.lf-conn-offline { color: var(--danger); }
.lf-dot { width: 8px; height: 8px; background: currentColor; flex: none; }
/* Only the two unhealthy states pulse. Motion here means "something is wrong",
   never decoration — a steady dot is the good news. */
.lf-conn-connecting .lf-dot,
.lf-conn-reconnecting .lf-dot { animation: lf-pulse 1.4s ease-in-out infinite; }
@keyframes lf-pulse { 50% { opacity: .25; } }

/* ── buttons ────────────────────────────────────────────────────────────── */
.lf-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; /* touch target, phone-on-the-desk case */
  padding: 0 var(--s3);
  font-family: var(--mono); font-size: 10px; letter-spacing: .5px;
  color: var(--muted); background: transparent;
  border: 2px solid var(--border); cursor: pointer;
  text-decoration: none;
  transition: color 160ms ease-out, border-color 160ms ease-out, background 160ms ease-out;
}
.lf-btn:hover { color: var(--text); border-color: var(--border-hi); background: var(--surface); }
.lf-btn:active { background: var(--surface-hi); }
.lf-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.lf-btn-accent { color: var(--accent); border-color: var(--accent); }
.lf-btn-warn { color: var(--warn); border-color: var(--warn); }
.lf-btn-warn:hover { color: var(--warn); border-color: var(--warn); }

/* ── feed ───────────────────────────────────────────────────────────────── */
.lf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s2); }

.lf-card {
  border: 3px solid var(--border);
  background: var(--surface);
  padding: var(--s3);
  transition: border-color 200ms ease-out, background 200ms ease-out;
}
.lf-card.is-new {
  border-color: var(--accent);
  background: var(--surface-hi);
  animation: lf-in 220ms ease-out both;
}
.lf-card.is-muted { opacity: .66; }
@keyframes lf-in { from { opacity: 0; transform: translateY(-6px); } }

.lf-card-head { display: flex; align-items: baseline; gap: var(--s2); flex-wrap: wrap; }
/* Amount leads: at a metre, "how much" is the datum that decides whether this
   is worth turning your head for. */
.lf-amount { font-family: var(--mono); font-size: 18px; color: var(--accent); }
.lf-name { font-family: var(--dot); font-size: 20px; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.lf-time { font-family: var(--dot); font-size: 13px; color: var(--muted); margin-left: auto; white-space: nowrap; }

.lf-treat { margin: var(--s2) 0 0; font-family: var(--dot); font-size: 15px; color: var(--muted); }
.lf-message {
  margin: var(--s2) 0 0;
  font-family: var(--dot); font-size: 18px; line-height: 1.55; color: var(--text);
  overflow-wrap: anywhere;
}

.lf-tags { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: var(--s3) 0 0; padding: 0; }
.lf-tag {
  font-family: var(--mono); font-size: 9px; letter-spacing: .5px;
  border: 2px solid currentColor; padding: 3px 6px;
}
.lf-tag-neutral { color: var(--muted); }
.lf-tag-warn    { color: var(--warn); }
.lf-tag-danger  { color: var(--danger); }
.lf-tag-info    { color: var(--info); }

/* ── skeleton + empty ───────────────────────────────────────────────────── */
.lf-skel { display: flex; flex-direction: column; gap: var(--s2); }
.lf-skel-bar { height: 14px; background: var(--surface-hi); animation: lf-shimmer 1.3s ease-in-out infinite; }
.lf-skel:nth-child(2) .lf-skel-bar { animation-delay: .1s; }
.lf-skel:nth-child(3) .lf-skel-bar { animation-delay: .2s; }
.lf-skel:nth-child(4) .lf-skel-bar { animation-delay: .3s; }
@keyframes lf-shimmer { 50% { opacity: .45; } }

.lf-empty { text-align: center; padding: 56px var(--s4); }
.lf-empty-title { font-family: var(--dot); font-size: 20px; color: var(--text); margin: 0 0 var(--s2); }
.lf-empty-hint {
  font-family: var(--dot); font-size: 15px; line-height: 1.6; color: var(--muted);
  margin: 0 auto var(--s4); max-width: 42ch;
}
.lf-danger { color: var(--danger); }

@media (max-width: 420px) {
  .lf-title { width: 100%; }
  .lf-updated { margin-left: 0; width: 100%; }
  .lf-amount { font-size: 16px; }
  .lf-name { font-size: 18px; }
}

/* Someone who has asked for less motion still needs the connection warning and
   the new-tip highlight — those carry meaning. Only the movement goes. */
@media (prefers-reduced-motion: reduce) {
  .lf *, .lf *::before, .lf *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  .lf-conn-connecting .lf-dot, .lf-conn-reconnecting .lf-dot { opacity: .6; }
}
`;
