import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "steamcards-theme";

/** ?theme=light|dark|system — handy for headless screenshots. */
export function themeOverrideFromUrl(): Theme | null {
  try {
    const value = new URLSearchParams(window.location.search).get("theme");
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* storage may be unavailable */
  }
  return "system";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#1a1a1a" : "#f5f5f5");
  return resolved;
}

export interface ThemeController {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

export function useTheme(): ThemeController {
  const [theme, setThemeState] = useState<Theme>(() => themeOverrideFromUrl() ?? readStoredTheme());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(applyTheme(theme));
    // A URL override is for previews only — don't overwrite the saved preference.
    if (themeOverrideFromUrl() == null) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        /* ignore */
      }
    }
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") setResolved(applyTheme("system"));
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, resolved, setTheme };
}
