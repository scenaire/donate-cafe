import type { Metadata } from "next";
import { Quicksand, Noto_Sans_Thai, Noto_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./providers";
import { themeCss } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Send a Message — Naire",
  description: "Send Naire a message with an on-screen shoutout.",
};

// Self-hosted at build time by next/font — no render-blocking request to Google
// Fonts on any route (including the /alert OBS overlay, where a slow or failed
// third-party font would delay the on-stream shoutout). Each font exposes a CSS
// variable that lib/theme.ts composes into --font-display / --font-body; the
// variable names here MUST match the ones referenced there. Weights are omitted
// because these are variable fonts, so the full 400–700 range the CSS uses is
// covered by one file each.
const quicksand = Quicksand({ subsets: ["latin"], variable: "--font-quicksand", display: "swap" });
const notoSansThai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-noto-thai", display: "swap" });
const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-noto-sans", display: "swap" });
const fontVars = `${quicksand.variable} ${notoSansThai.variable} ${notoSans.variable}`;

// Runs before first paint to set the theme with no flash of the wrong colors.
// Reads a saved choice, else falls back to the OS preference.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

// Thai is the app's default UI language. app/page.tsx and app/dashboard/page.tsx
// re-sync this attribute client-side when the visitor switches, which a server
// component can't do on its own.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={fontVars} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
