import { useAssetObjectUrl } from "@/api/asset-blob"

import { assetUrl, customAvatarRequestPath } from "./assets"

/**
 * Resolves a stored profile picture to something an <img> can load, whichever shape it
 * is. A bundled avatar is a static file and answers on the first render; an uploaded one
 * lives behind the API bearer token, so its bytes are fetched and handed over as a blob
 * URL and this returns null for the moment in between.
 */
export function useAvatarUrl(stored: string): string | null {
  const uploaded = useAssetObjectUrl(customAvatarRequestPath(stored))
  return uploaded ?? assetUrl(stored)
}
