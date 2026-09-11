import { useAssetObjectUrl } from "@/api/asset-blob"

import { customProfilePictureRequestPath } from "./assets"

/** Resolves an uploaded picture to a browser object URL. */
export function useProfilePictureUrl(stored: string): string | null {
  return useAssetObjectUrl(customProfilePictureRequestPath(stored))
}
