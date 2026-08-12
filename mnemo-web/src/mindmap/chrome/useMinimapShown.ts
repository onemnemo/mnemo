import { useSettingValue } from "@/settings/store"

/**
 * Whether the minimap is up.
 *
 * Auto is the default and means "while there is a map to be lost in": an empty canvas has no shape to
 * show, and a panel of nothing in the corner of a blank map is furniture.
 */
export function useMinimapShown(hasElements: boolean): boolean {
  const mode = useSettingValue("Mindmap.MinimapVisibility", "Auto")
  if (mode === "Off") {
    return false
  }
  return mode === "On" || hasElements
}
