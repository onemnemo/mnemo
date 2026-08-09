import { create } from "zustand"

import { putSettingValue } from "@/settings/api"

/**
 * Whether the app animates.
 *
 * Three states, not two. "system" is the default and defers to prefers-reduced-motion,
 * which the CSS already honours on its own; the other two are the user overriding it in
 * either direction. Collapsing this to a boolean would mean picking a value for people
 * who never opened Settings, and either choice is wrong for half of them.
 *
 * The DOM contract is the `data-motion` attribute on <html>, read by the motion tokens in
 * styles/tokens.css. "system" removes the attribute rather than setting a value, so the
 * media query is left to decide.
 */
export type MotionPreference = "system" | "full" | "reduced"

const SETTING_KEY = "App.ReduceMotion"

/** First-paint cache, mirroring the theme one. Read by the inline script in index.html. */
const PAINT_HINT_KEY = "mnemo.motion"

export const DEFAULT_MOTION: MotionPreference = "system"

function applyMotion(preference: MotionPreference): void {
  const root = document.documentElement
  if (preference === "system") root.removeAttribute("data-motion")
  else root.setAttribute("data-motion", preference)

  try {
    if (preference === "system") localStorage.removeItem(PAINT_HINT_KEY)
    else localStorage.setItem(PAINT_HINT_KEY, preference)
  } catch {
    // Non-fatal: the preference still applies for this session.
  }
}

/** A stored value as a preference. Anything unrecognised, including absent, is "system". */
export function resolveMotionPreference(value: string | null | undefined): MotionPreference {
  return value === "full" || value === "reduced" ? value : DEFAULT_MOTION
}

interface MotionState {
  preference: MotionPreference
  /** Apply a preference from persisted settings without writing back (startup). */
  hydrate: (preference: MotionPreference) => void
  set: (preference: MotionPreference) => void
}

export const useMotionStore = create<MotionState>((set) => ({
  preference: DEFAULT_MOTION,
  hydrate: (preference) => {
    applyMotion(preference)
    set({ preference })
  },
  set: (preference) => {
    applyMotion(preference)
    set({ preference })
    // Fire-and-forget, same as the theme: the DOM already reflects the change and
    // persistence is background work the user does not wait on.
    void putSettingValue(SETTING_KEY, preference)
  },
}))
