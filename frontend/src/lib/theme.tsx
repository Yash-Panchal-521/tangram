"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "terracotta" | "slate" | "indigo" | "forest" | "graphite" | "midnight";

/**
 * The palettes, in the order the picker offers them.
 *
 * Kept here rather than derived from the stylesheet because nothing can read
 * which `[data-theme]` blocks exist at runtime — CSS is not introspectable that
 * way — so this list and globals.css have to be changed together. A palette
 * added to one and not the other is either an option that does nothing or a
 * block nobody can reach.
 */
export const THEMES: { id: ThemeName; name: string; hint: string }[] = [
  { id: "terracotta", name: "Terracotta", hint: "Warm, earthy, light-first" },
  { id: "slate", name: "Slate", hint: "Neutral grey with a blue accent" },
  { id: "indigo", name: "Indigo", hint: "Atlassian's own family" },
  { id: "forest", name: "Forest", hint: "Warm-neutral, green accent" },
  { id: "graphite", name: "Graphite", hint: "Near-monochrome" },
  { id: "midnight", name: "Midnight", hint: "Dark-first, violet accent" },
];
export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "tangram-theme";
const MODE_STORAGE_KEY = "tangram-mode";
const DEFAULT_THEME: ThemeName = "terracotta";
const DEFAULT_MODE: ThemeMode = "light";

// Inlined into <head> so the theme/mode attributes are set before first
// paint -- avoids a flash of the wrong theme on load.
//
// Light is the default outright, rather than following
// prefers-color-scheme. Terracotta was designed light-first, and deferring to
// the OS meant anyone on a dark desktop never saw the intended palette without
// hunting for the toggle. A stored choice still wins, so the toggle is sticky.
export const themeInitScript = `
(function () {
  try {
    var theme = localStorage.getItem("${THEME_STORAGE_KEY}") || "${DEFAULT_THEME}";
    var mode = localStorage.getItem("${MODE_STORAGE_KEY}") || "${DEFAULT_MODE}";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
  } catch (e) {}
})();
`;

interface ThemeContextValue {
  theme: ThemeName;
  mode: ThemeMode;
  setTheme: (theme: ThemeName) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);

  useEffect(() => {
    // Reconciles React state with the mode the blocking <head> script already
    // applied to the DOM before hydration (localStorage, falling back to
    // system preference) -- the server render has no localStorage or
    // matchMedia, so this one-time sync is required and intentionally not
    // driven by an external-store subscription.
    const applied = document.documentElement.dataset.mode as ThemeMode | undefined;
    const appliedTheme = document.documentElement.dataset.theme as ThemeName | undefined;
    // Both, in one pass: the blocking head script has already put the stored
    // mode and palette on the element, and the server render could not have
    // known either. One disable covers the pair — the rule reports the block,
    // not each call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (applied) setModeState(applied);
    if (appliedTheme) setThemeState(appliedTheme);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(MODE_STORAGE_KEY, next);
    document.documentElement.dataset.mode = next;
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
