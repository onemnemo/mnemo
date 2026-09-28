import { useSettingsStore, useSettingValue } from "@/settings/store"

export type MinimapMode = "On" | "Auto" | "Off"

const KEY = "Mindmap.MinimapVisibility"

/** What a press of the map button moves to. */
export const NEXT_MODE: Record<MinimapMode, MinimapMode> = { On: "Auto", Auto: "Off", Off: "On" }

/**
 * The minimap setting, and whether the map card is up. The one place the setting meets the Auto rule:
 * in Auto the card is up while part of the map is off screen.
 */
export function useMinimapShown(offScreen: boolean): {
  mode: MinimapMode
  shown: boolean
  setMode: (mode: MinimapMode) => void
} {
  const stored = useSettingValue(KEY, "Auto")
  const setValue = useSettingsStore((state) => state.setValue)
  const mode: MinimapMode = stored === "On" || stored === "Off" ? stored : "Auto"
  return {
    mode,
    shown: mode === "On" || (mode === "Auto" && offScreen),
    setMode: (next) => void setValue(KEY, next),
  }
}
