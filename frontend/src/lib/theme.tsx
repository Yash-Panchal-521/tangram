"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "terracotta";
export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "tangram-theme";
const MODE_STORAGE_KEY = "tangram-mode";
const DEFAULT_THEME: ThemeName = "terracotta";
const DEFAULT_MODE: ThemeMode = "light";

// Inlined into <head> so the theme/mode attributes are set before first
// paint -- avoids a flash of the wrong theme on load.
export const themeInitScript = `
(function () {
  try {
    var theme = localStorage.getItem("${THEME_STORAGE_KEY}") || "${DEFAULT_THEME}";
    var mode = localStorage.getItem("${MODE_STORAGE_KEY}") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "${DEFAULT_MODE}");
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
  } catch (e) {}
})();
`;

interface ThemeContextValue {
  theme: ThemeName;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme] = useState<ThemeName>(DEFAULT_THEME);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);

  useEffect(() => {
    // Reconciles React state with the mode the blocking <head> script already
    // applied to the DOM before hydration (localStorage, falling back to
    // system preference) -- the server render has no localStorage or
    // matchMedia, so this one-time sync is required and intentionally not
    // driven by an external-store subscription.
    const applied = document.documentElement.dataset.mode as ThemeMode | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (applied) setModeState(applied);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(MODE_STORAGE_KEY, next);
    document.documentElement.dataset.mode = next;
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
