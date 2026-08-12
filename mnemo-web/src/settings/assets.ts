// The profile-picture and app-icon galleries persist Avalonia resource URIs, because
// the desktop app reads the same values out of the same database. The SPA cannot load
// an avares:// URI, so it keeps storing them and maps them onto its own static copies
// at render time. The app icons are the PNGs extracted from the shipped .ico files.
//
// A picture the user supplied is a third shape stored in the same key, prefixed so the
// desktop app recognises it as something it cannot resolve and falls back to its default
// rather than rendering a broken image.

import { apiFetch } from "@/api/client"

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

/* -------------------------------------------------------------------------- */
/* A picture from the user's own files                                        */

const CUSTOM_AVATAR_PREFIX = "profile-asset:"

/** The value stored for an uploaded avatar. */
export function customAvatarReference(assetId: string): string {
  return `${CUSTOM_AVATAR_PREFIX}${assetId}`
}

export function isCustomAvatar(stored: string): boolean {
  return stored.startsWith(CUSTOM_AVATAR_PREFIX)
}

/**
 * The API request path serving an uploaded avatar's bytes, or null for any other stored
 * shape. Ids with a separator are rejected here as well as on the host, so a malformed
 * value can never be pasted into a request path.
 */
export function customAvatarRequestPath(stored: string): string | null {
  if (!isCustomAvatar(stored)) return null

  const assetId = stored.slice(CUSTOM_AVATAR_PREFIX.length)
  if (assetId.length === 0 || assetId.includes("/") || assetId.includes("\\") || assetId.includes(".."))
    return null

  return `/api/profile/avatar/${encodeURIComponent(assetId)}`
}

/** Matches the host's limit, so an oversized file is refused before it is sent. */
export const MAX_AVATAR_BYTES = 20 * 1024 * 1024

const AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]

/**
 * The Settings i18n key naming why a file cannot be used as an avatar, or null when it
 * can. The host applies the same two rules and a magic-number check on top; this only
 * saves a doomed upload the round trip.
 */
export function avatarUploadProblem(file: { name: string; size: number }): string | null {
  if (file.size > MAX_AVATAR_BYTES) return "AvatarUploadTooLarge"

  const dot = file.name.lastIndexOf(".")
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ""
  if (!AVATAR_EXTENSIONS.includes(extension)) return "AvatarUploadUnsupported"

  return null
}

/** Uploads a picture and returns the value to store in the profile picture setting. */
export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  const dto = await apiFetch<{ assetId: string }>("/profile/avatar", { method: "POST", body: form })
  return customAvatarReference(dto.assetId)
}
