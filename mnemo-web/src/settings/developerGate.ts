import { useRef } from "react"

import { useSettingsStore } from "./store"

/** Taps needed on the Settings title, and the window they must fall within. */
const TAPS_REQUIRED = 7
const TAP_WINDOW_MS = 2000

/**
 * The hidden developer gate: tapping the Settings title seven times inside two
 * seconds reveals the Developer-mode switch in General. That switch, in turn, reveals
 * the Developer category, two stages, so a stray flurry of clicks cannot surface a
 * whole page of diagnostics.
 */
export function useDeveloperGateTap(): () => void {
  const taps = useRef(0)
  const last = useRef(0)
  const setValue = useSettingsStore((s) => s.setValue)
  const unlocked = useSettingsStore((s) => s.values["App.DeveloperModeGateUnlocked"] === true)

  return () => {
    if (unlocked) return

    const now = Date.now()
    taps.current = now - last.current > TAP_WINDOW_MS ? 1 : taps.current + 1
    last.current = now

    if (taps.current < TAPS_REQUIRED) return

    taps.current = 0
    void setValue("App.DeveloperModeGateUnlocked", true)
  }
}
