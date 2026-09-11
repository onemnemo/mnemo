import { apiFetch } from "@/api/client"

const CUSTOM_PROFILE_PICTURE_PREFIX = "profile-asset:"

/** The value stored for a picture copied into the profile directory. */
export function customProfilePictureReference(assetId: string): string {
  return `${CUSTOM_PROFILE_PICTURE_PREFIX}${assetId}`
}

export function isCustomProfilePicture(stored: string): boolean {
  return stored.startsWith(CUSTOM_PROFILE_PICTURE_PREFIX)
}

/** The authenticated request path for a valid stored profile picture reference. */
export function customProfilePictureRequestPath(stored: string): string | null {
  if (!isCustomProfilePicture(stored)) return null

  const assetId = stored.slice(CUSTOM_PROFILE_PICTURE_PREFIX.length)
  if (assetId.length === 0 || assetId.includes("/") || assetId.includes("\\") || assetId.includes(".."))
    return null

  return `/api/profile/avatar/${encodeURIComponent(assetId)}`
}

/** Matches the host limit, so an oversized file is refused before it is sent. */
export const MAX_PROFILE_PICTURE_BYTES = 20 * 1024 * 1024

const PROFILE_PICTURE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]

/** The Settings key explaining why a file cannot be used, or null when it can. */
export function profilePictureUploadProblem(file: { name: string; size: number }): string | null {
  if (file.size > MAX_PROFILE_PICTURE_BYTES) return "ProfilePictureUploadTooLarge"

  const dot = file.name.lastIndexOf(".")
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ""
  if (!PROFILE_PICTURE_EXTENSIONS.includes(extension)) return "ProfilePictureUploadUnsupported"

  return null
}

/** Uploads a picture and returns the reference stored in profile settings. */
export async function uploadProfilePicture(file: File): Promise<string> {
  const form = new FormData()
  form.append("file", file)
  const dto = await apiFetch<{ assetId: string }>("/profile/avatar", { method: "POST", body: form })
  return customProfilePictureReference(dto.assetId)
}
