"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { mode, toggleMode } = useTheme();

  return (
    <button
      onClick={toggleMode}
      title="Toggle dark/light"
      aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md border border-border bg-surface text-text-muted cursor-pointer hover:border-border-2 transition-colors"
    >
      {mode === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2.5" fill="currentColor" />
          <path
            d="M7 1.5V3M7 11V12.5M1.5 7H3M11 7H12.5M3.2 3.2L4.2 4.2M9.8 9.8L10.8 10.8M10.8 3.2L9.8 4.2M4.2 9.8L3.2 10.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M11.2 8.8A5 5 0 015.2 2.8 5 5 0 1011.2 8.8z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
