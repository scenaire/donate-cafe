"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readAttrTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from the attribute the pre-hydration script already set on <html>,
  // so state and DOM never disagree.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // Deliberate one-time correction, not derived state: the pre-hydration
    // script already set the DOM attribute (see layout.tsx) so SSR and the
    // first paint agree; this effect only syncs React state to match after
    // mount. A lazy useState initializer would run during SSR too and diverge
    // from the attribute the script sets, reintroducing the mismatch this
    // avoids.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readAttrTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(readAttrTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
