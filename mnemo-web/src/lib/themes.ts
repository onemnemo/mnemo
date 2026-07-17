// The built-in theme catalog, mirroring the Avalonia reference manifests
// (Mnemo.UI/Themes/Core/*/manifest.json). Once GET /themes exists this becomes
// server-sourced (with user themes appended); the ids must stay in lockstep with
// the [data-theme] blocks in styles/tokens.css.

export type ThemeId = "dawn" | "dusk" | "ember" | "noon"
export type ThemeAppearance = "light" | "dark"

export interface ThemeInfo {
  id: ThemeId
  name: string
  description: string
  appearance: ThemeAppearance
}

export const THEMES: readonly ThemeInfo[] = [
  { id: "dawn", name: "Dawn", description: "Mnemo's default light theme", appearance: "light" },
  { id: "dusk", name: "Dusk", description: "Mnemo's default dark theme", appearance: "dark" },
  { id: "ember", name: "Ember", description: "Mnemo's warm dark theme", appearance: "dark" },
  { id: "noon", name: "Noon", description: "Mnemo's warm editorial light theme", appearance: "light" },
]

export const DEFAULT_THEME: ThemeId = "dawn"

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id))

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value != null && THEME_IDS.has(value)
}
