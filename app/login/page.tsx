"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { dashboardTranslations, isLang, type Lang } from "@/lib/i18n";
import { BRAND_NAME } from "@/lib/brand";
import ThemeToggle from "@/components/ThemeToggle";

// Email + password sign-in for the single admin account.
//
// Chosen over magic links deliberately: this is one operator signing in to one
// dashboard, and a magic link puts an email provider on the critical path of
// getting into your own admin panel. Supabase's built-in SMTP is rate-limited
// to a handful of messages an hour and fails silently when you exceed it, which
// is a miserable failure mode when you are mid-stream and need the override
// button.
//
// Nothing about the authorisation model changes: the session only proves you
// hold these credentials, and requireAdmin() in lib/supabase-server.ts still
// checks the address against ADMIN_EMAIL on every protected request.
//
// The account is created by hand in the Supabase dashboard. There is no signup
// form and no password-reset flow — if you lock yourself out, set a new
// password from Authentication → Users.
export default function LoginPage() {
  const [lang, setLang] = useState<Lang>("th");
  const t = dashboardTranslations[lang];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      // One message for every failure. Distinguishing "no such user" from
      // "wrong password" would turn this form into a probe for the admin
      // address, and there is exactly one to find.
      setState("error");
      return;
    }
    // createBrowserClient persists the session to cookies, so the server-side
    // routes can read it on the very next request. A full navigation (rather
    // than a client-side push) guarantees those cookies are attached.
    window.location.href = "/dashboard";
  }

  return (
    <>
      <ThemeToggle />
      <div className="card" style={{ maxWidth: 420, margin: "0 auto", padding: "28px 24px" }}>
        <div className="lang-toggle">
          <button type="button" className={lang === "th" ? "active" : ""} onClick={() => setLang("th")}>
            ไทย
          </button>
          <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
            EN
          </button>
        </div>

        <p className="eyebrow">{BRAND_NAME}</p>
        <h1>{t.loginTitle}</h1>
        <p className="subtitle">{t.loginSubtitle}</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">{t.loginEmail}</label>
            <input
              id="email"
              type="email"
              required
              maxLength={100}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="password">{t.loginPassword}</label>
            <input
              id="password"
              type="password"
              required
              maxLength={200}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {state === "error" && <p className="error-text">{t.loginFailed}</p>}

          <button type="submit" disabled={state === "busy"}>
            {state === "busy" ? t.loginBusy : t.loginBtn}
          </button>
        </form>
      </div>
    </>
  );
}
