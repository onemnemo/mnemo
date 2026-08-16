// The theme catalog. Two themes, matching the [data-theme] blocks in styles/tokens.css,
// plus the option of letting the operating system pick between them.
//
// The app used to ship four (dawn, noon, dusk, ember) ported from the Avalonia themes.
// The rehaul replaced that palette with a single light and dark pair, so the old ids
// survive only as something to migrate off: they are still sitting in Appearance.Theme
// for every existing install.

/** A theme that can actually be rendered. This is what lands on `data-theme`. */
export type ThemeId = "light" | "dark"

/** What the user chose. "system" resolves to a {@link ThemeId} at apply time. */
export type ThemePreference = ThemeId | "system"

export type ThemeAppearance = "light" | "dark"

/**
 * The surfaces a theme card draws its miniature app from.
 *
 * Literal rather than read off the live tokens, because every theme has to be
 * previewable at once and only one of them is applied at any moment. Transcribed from
 * `styles/tokens.css`; a change there is a change here.
 */
export interface ThemeSurfaces {
  /** The sidebar rail. */
  frame: string
  /** The page the module sits on. */
  canvas: string
  /** Text, at full strength. The preview steps it down with opacity. */
  ink: string
  /** The hairline between rail and canvas. */
  line: string
}

export interface ThemeInfo {
  id: ThemeId
  name: string
  description: string
  appearance: ThemeAppearance
  surfaces: ThemeSurfaces
}

export const THEMES: readonly ThemeInfo[] = [
  {
    id: "light",
    name: "Light",
    description: "Paper",
    appearance: "light",
    surfaces: {
      frame: "oklch(0.988 0.0015 260)",
      canvas: "oklch(1 0 0)",
      ink: "oklch(0.26 0.008 260)",
      line: "oklch(0.9 0.00225 260)",
    },
  },
  {
    id: "dark",
    name: "Dark",
    description: "Ink",
    appearance: "dark",
    surfaces: {
      frame: "oklch(0.203 0.005 260)",
      canvas: "oklch(0.218 0.006 260)",
      ink: "oklch(0.955 0.003 260)",
      line: "oklch(0.31 0.008 260)",
    },
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

/**
 * A stored value as a preference, keeping "system" distinct from whatever it currently
 * resolves to. Everything else collapses through {@link resolveThemeId}.
 */
export function resolveThemePreference(value: string | null | undefined): ThemePreference {
  return value === "system" ? "system" : resolveThemeId(value)
}

const DARK_QUERY = "(prefers-color-scheme: dark)"

/**
 * The OS colour-scheme query, or null where there is nothing to ask.
 *
 * Checked rather than assumed because this module is imported by components under
 * test, and a DOM implementation is free to omit `matchMedia`. A theme is not worth
 * taking a test environment, or a webview, down over.
 */
function darkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null
  return window.matchMedia(DARK_QUERY)
}

/** What the operating system currently asks for. */
export function systemTheme(): ThemeId {
  return darkQuery()?.matches ? "dark" : "light"
}

/**
 * Calls back whenever the operating system's preference flips. Returns the disposer.
 *
 * Separate from the store so the store owns *when* it matters (only while the
 * preference is "system") rather than having to know how the platform reports it.
 */
export function watchSystemTheme(onChange: (theme: ThemeId) => void): () => void {
  const query = darkQuery()
  if (!query) return () => {}
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? "dark" : "light")
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

/** The theme a preference renders as right now. */
export function themeFor(preference: ThemePreference): ThemeId {
  return preference === "system" ? systemTheme() : preference
}
