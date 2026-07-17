import { create } from "zustand"

import { DEFAULT_THEME, isThemeId, type ThemeId } from "@/lib/themes"

// Where the chosen theme is remembered. This is an interim home: the desktop app
// persists the theme in backend settings, which is where this will live.
// localStorage keeps the skeleton self-
// contained and flash-free (see the early-apply script in index.html).
const STORAGE_KEY = "mnemo.theme"

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(stored)) return stored
  } catch {
    // localStorage can throw in locked-down contexts; fall back to the default.
  }
  return DEFAULT_THEME
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme)
}

interface ThemeState {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Non-fatal: the theme still applies for this session.
    }
    set({ theme })
  },
}))

// Reconcile the DOM with the store on module load. The early-apply script in
// index.html has usually already set data-theme; this makes React authoritative.
applyTheme(useThemeStore.getState().theme)
