// The theme catalog. Two themes, matching the [data-theme] blocks in styles/tokens.css.
//
// The app used to ship four (dawn, noon, dusk, ember) ported from the Avalonia themes.
// The rehaul replaced that palette with a single light and dark pair, so the old ids
// survive only as something to migrate off: they are still sitting in Appearance.Theme
// for every existing install, and in whatever GET /themes reports.

export type ThemeId = "light" | "dark"
export type ThemeAppearance = "light" | "dark"

export interface ThemeInfo {
  id: ThemeId
  name: string
  description: string
  appearance: ThemeAppearance
  /**
   * Swatches for the picker, in rail-to-accent order. Literal rather than read off the
   * live tokens, because both themes have to be previewable at once and only one of
   * them is the applied one at any moment.
   */
  previewColors: readonly string[]
}

export const THEMES: readonly ThemeInfo[] = [
  {
    id: "light",
    name: "Light",
    description: "Mnemo's default light theme",
    appearance: "light",
    previewColors: ["oklch(0.988 0.0015 260)", "oklch(1 0 0)", "oklch(0.937 0.003 260)", "oklch(0.63 0.185 40)"],
  },
  {
    id: "dark",
    name: "Dark",
    description: "Mnemo's dark theme",
    appearance: "dark",
    previewColors: ["oklch(0.203 0.005 260)", "oklch(0.218 0.006 260)", "oklch(0.288 0.009 260)", "oklch(0.7 0.17 40)"],
  },
]

export const DEFAULT_THEME: ThemeId = "light"

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id))

/**
 * Retired theme ids, mapped to whichever of the two replaced them.
 *
 * Read-only compatibility: a stored id is translated on the way in and the new id is
 * written back on the next change. Dropping the entry instead would silently reset a
 * dark-theme user to light on upgrade, which reads as the app losing their settings.
 */
const RETIRED: Record<string, ThemeId> = {
  dawn: "light",
  noon: "light",
  dusk: "dark",
  ember: "dark",
}

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value != null && THEME_IDS.has(value)
}

/**
 * A stored or server-supplied theme id as one this build can render.
 *
 * Unknown ids fall back to the default rather than being applied: a `data-theme` nothing
 * is styled for produces an unreadable window, which is worse than the wrong theme.
 */
export function resolveThemeId(value: string | null | undefined): ThemeId {
  if (isThemeId(value)) return value
  if (value != null && value in RETIRED) return RETIRED[value]
  return DEFAULT_THEME
}
