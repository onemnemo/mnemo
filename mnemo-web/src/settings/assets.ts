// The profile-picture and app-icon galleries persist Avalonia resource URIs, because
// the desktop app reads the same values out of the same database. The SPA cannot load
// an avares:// URI, so it keeps storing them and maps them onto its own static copies
// at render time. The app icons are the PNGs extracted from the shipped .ico files.

const PROFILE_PICTURE_PREFIX = "avares://Mnemo.UI/Assets/ProfilePictures/"
const APP_ICON_PREFIX = "avares://Mnemo.UI/Assets/AppIcons/"

/** The six bundled avatars, as the values they persist as. */
export const PROFILE_PICTURES: string[] = Array.from(
  { length: 6 },
  (_, i) => `${PROFILE_PICTURE_PREFIX}img${i}.png`,
)

export const DEFAULT_PROFILE_PICTURE = `${PROFILE_PICTURE_PREFIX}img2.png`

/** The five bundled app icons, as the values they persist as, in the desktop's order. */
export const APP_ICONS: string[] = ["Dawn", "Dusk", "Aurora", "Ember", "Earth"].map(
  (name) => `${APP_ICON_PREFIX}AppIcon${name}.ico`,
)

export const DEFAULT_APP_ICON = `${APP_ICON_PREFIX}AppIconDawn.ico`

/**
 * Resolves a stored resource URI to something an <img> can load. Returns null for a
 * value from outside the bundled sets, so a gallery renders a blank tile rather than
 * a broken image.
 */
export function assetUrl(stored: string): string | null {
  if (stored.startsWith(PROFILE_PICTURE_PREFIX))
    return `/profile-pictures/${stored.slice(PROFILE_PICTURE_PREFIX.length)}`

  if (stored.startsWith(APP_ICON_PREFIX))
    return `/app-icons/${stored.slice(APP_ICON_PREFIX.length).replace(/\.ico$/i, ".png")}`

  return null
}

/** The human-readable name of a bundled asset ("AppIconDawn.ico" -> "Dawn"). */
export function appIconName(stored: string): string {
  return stored.slice(APP_ICON_PREFIX.length).replace(/^AppIcon/, "").replace(/\.ico$/i, "")
}
