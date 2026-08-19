import type { Metadata } from "next";
import { DotGothic16, Silkscreen, IBM_Plex_Sans_Thai_Looped } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./providers";
import { themeCss } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Whispering Rain Café — send Naire a treat",
  description: "Buy Naire a treat, leave a note, and get a shout-out on stream.",
};

// Self-hosted at build time by next/font — no render-blocking request to Google
// Fonts on any route (including the /alert OBS overlay, where a slow or failed
// third-party font would delay the on-stream shoutout). Each font exposes a CSS
// variable that lib/theme.ts composes into --font-display / --font-label /
// --font-body; the variable names here MUST match the ones referenced there.
// These are bitmap/pixel display fonts with fixed weights, so weights are listed
// explicitly (unlike variable fonts).
const dotGothic = DotGothic16({ subsets: ["latin"], weight: "400", variable: "--font-dotgothic", display: "swap" });
const silkscreen = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-silkscreen", display: "swap" });
const plexThai = IBM_Plex_Sans_Thai_Looped({
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-thai",
  display: "swap",
});
const fontVars = `${dotGothic.variable} ${silkscreen.variable} ${plexThai.variable}`;

// Thai is the app's default UI language. app/page.tsx and app/dashboard/page.tsx
// re-sync this attribute client-side when the visitor switches, which a server
// component can't do on its own. No theme pre-paint script — the design is a
// single fixed palette (no dark mode).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={fontVars} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
