"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, isCurrency } from "@/lib/money";
import { BRAND_NAME } from "@/lib/brand";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { GOAL_EVENT, channelName, type GoalUpdatePayload } from "@/lib/realtime.shared";
import { DEFAULT_JAR_CONFIG, jarFillCss, jarBackingCss, renderHtmlTemplate, type JarConfig, type JarTokens } from "@/lib/cafe";

// The OBS "Goal bar" Browser Source. Deliberately much simpler than /alert:
// there's no queue, no chime, no TTS — just "what is the current goal state,"
// redrawn the instant a tip clears via the same realtime channel /alert
// listens on (same widget token, same "one paste per widget" design), with a
// periodic poll as the reconciliation fallback for anything the socket missed
// (a dropped connection) or that isn't tip-driven at all (the creator editing
// the goal's label/target in Settings while live).

const POLL_MS = 30_000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

type GoalState = NonNullable<GoalUpdatePayload["goal"]>;

export default function GoalOverlay() {
  const [token, setToken] = useState<string | null>(null);
  const [goal, setGoal] = useState<GoalState | null>(null);
  const [jarConfig, setJarConfig] = useState<JarConfig>(DEFAULT_JAR_CONFIG);
  const tokenRef = useRef("");

  async function load() {
    try {
      const res = await fetch(`/api/summary?token=${encodeURIComponent(tokenRef.current)}`);
      if (!res.ok) return;
      const data = await res.json();
      setGoal((data.goal as GoalState | null) ?? null);
      setJarConfig({ ...DEFAULT_JAR_CONFIG, ...(data.jarConfig as Partial<JarConfig> | undefined) });
    } catch (err) {
      console.error("goal-overlay load failed", err);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    tokenRef.current = params.get("token") || "";
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
        .on("broadcast", { event: GOAL_EVENT }, ({ payload }: { payload: GoalUpdatePayload }) => {
          setGoal(payload.goal);
        })
        .subscribe((status: string) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            backoff = BACKOFF_START_MS;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
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
  }, [token]);

  // ── Reconciliation poll ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(load, POLL_MS);
    load();
    return () => clearInterval(interval);
  }, [token]);

  if (token === "") {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", fontFamily: "var(--font-display)" }}>
        <div style={{ background: "rgba(250,214,211,0.18)", backdropFilter: "blur(28px)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 20, padding: "20px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", maxWidth: 300, boxShadow: "0 16px 40px rgba(0,0,0,0.4)" }}>
          <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: 0 }}>{BRAND_NAME}</p>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>Missing ?token= in the Browser Source URL</p>
        </div>
      </div>
    );
  }

  // No active goal, or the creator has this specific toggle off — render
  // nothing rather than a stale/zeroed bar. Matches how show_on_screen gates
  // the alert widget.
  if (!goal || !goal.showOnOverlay) return null;

  const cur = isCurrency(goal.currency) ? goal.currency : "thb";
  const pctNum = Math.round(goal.progress * 100);
  const goalPct = `${pctNum}%`;
  const raised = formatMoney(goal.raisedMinor, cur);
  const target = formatMoney(goal.targetMinor, cur);
  const tokens: JarTokens = { goalName: goal.label, raised, target, goalPct };

  if (jarConfig.mode === "code") {
    const html = renderHtmlTemplate(jarConfig.html, tokens);
    const css = renderHtmlTemplate(jarConfig.css, tokens);
    const data = { ...tokens, pctNum };
    const boot = `<script>window.addEventListener('load',function(){try{var el=document.body.firstElementChild;var data=${JSON.stringify(data)};${jarConfig.js}}catch(e){}});<\/script>`;
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}${boot}</body></html>`;
    return (
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        title="goal bar"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
      />
    );
  }

  // SIMPLE mode
  const fillCss = jarFillCss(jarConfig.fill, jarConfig.texture);
  const backing = jarBackingCss(jarConfig.backing);
  const justify = jarConfig.align === "left" ? "flex-start" : jarConfig.align === "right" ? "flex-end" : "center";
  const labelStyle: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "#FFF6EA", textShadow: "0 1px 4px rgba(0,0,0,.5), 0 0 12px rgba(0,0,0,.3)" };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 16, pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: justify, gap: 10 }}>
          {jarConfig.showName && <span style={labelStyle}>{goal.label}</span>}
          {jarConfig.showPct && <span style={labelStyle}>{goalPct}</span>}
          {jarConfig.showAmount && <span style={labelStyle}>{raised} / {target}</span>}
        </div>
        <div style={{ height: jarConfig.heightPx, background: backing.background, boxShadow: backing.boxShadow, padding: 3 }}>
          <div style={{ height: "100%", background: fillCss, width: goalPct, transition: "width .5s" }} />
        </div>
      </div>
    </div>
  );
}
