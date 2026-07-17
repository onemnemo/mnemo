import { create } from "zustand"

import { putTheme } from "@/api/settings"
import { DEFAULT_THEME, type ThemeId } from "@/lib/themes"

// The chosen theme lives in backend settings (Appearance.Theme), shared with the
// desktop app. It is hydrated at startup (see SettingsProvider) and persisted on
// change. localStorage is kept only as a first-paint hint so a returning user does
// not flash the default theme before hydration completes - it is a cache, not the
// source of truth (see the early-apply script in index.html).
const PAINT_HINT_KEY = "mnemo.theme"

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme)
  try {
    localStorage.setItem(PAINT_HINT_KEY, theme)
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

interface ThemeState {
  theme: ThemeId
  /** Apply a theme from persisted settings without writing back (startup). */
  hydrate: (theme: ThemeId) => void
  /** Change the theme and persist it to backend settings. */
  setTheme: (theme: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,
  hydrate: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    // Fire-and-forget: the DOM already reflects the change; persistence is durable
    // background work the user does not wait on.
    void putTheme(theme)
  },
}))
