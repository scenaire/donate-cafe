"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/app/providers";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="theme-toggle">
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
      </button>
    </div>
  );
}
