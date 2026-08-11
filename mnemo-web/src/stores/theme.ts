import { create } from "zustand"

import { putTheme } from "@/api/settings"
import {
  DEFAULT_THEME,
  themeFor,
  watchSystemTheme,
  type ThemeId,
  type ThemePreference,
} from "@/lib/themes"

// The chosen theme lives in backend settings (Appearance.Theme), shared with the
// desktop app. It is hydrated at startup (see SettingsProvider) and persisted on
// change. localStorage is kept only as a first-paint hint so a returning user does
// not flash the default theme before hydration completes - it is a cache, not the
// source of truth (see the early-apply script in index.html).
const PAINT_HINT_KEY = "mnemo.theme"

function applyTheme(theme: ThemeId, preference: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", theme)
  try {
    // The preference, not the resolved theme: a machine that changed its mind while
    // the app was closed should paint the new answer, not the one from last time.
    localStorage.setItem(PAINT_HINT_KEY, preference)
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

interface ThemeState {
  /** What the user chose. */
  preference: ThemePreference
  /** What that renders as, and what is on `data-theme`. */
  theme: ThemeId
  /** Apply a preference from persisted settings without writing back (startup). */
  hydrate: (preference: ThemePreference) => void
  /** Change the preference and persist it to backend settings. */
  setPreference: (preference: ThemePreference) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: DEFAULT_THEME,
  theme: DEFAULT_THEME,
  hydrate: (preference) => {
    const theme = themeFor(preference)
    applyTheme(theme, preference)
    set({ preference, theme })
  },
  setPreference: (preference) => {
    const theme = themeFor(preference)
    applyTheme(theme, preference)
    set({ preference, theme })
    // Fire-and-forget: the DOM already reflects the change; persistence is durable
    // background work the user does not wait on.
    void putTheme(preference)
  },
}))

// One listener for the life of the process rather than a subscription per component:
// the operating system flipping is a fact about the machine, and the store decides
// whether it is currently being followed. Re-applying while the preference is explicit
// would override a choice the user made on purpose.
watchSystemTheme((theme) => {
  const state = useThemeStore.getState()
  if (state.preference !== "system" || state.theme === theme) return
  applyTheme(theme, "system")
  useThemeStore.setState({ theme })
})
