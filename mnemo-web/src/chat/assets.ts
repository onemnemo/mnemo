import { useAssetObjectUrl as useObjectUrl } from "@/api/asset-blob"

/** Loads a chat asset's bytes and exposes a blob URL for an <img>, revoking it on change. */
export function useAssetObjectUrl(assetId: string | null | undefined): string | null {
  return useObjectUrl(assetId ? `/api/chat/assets/${encodeURIComponent(assetId)}` : null)
}
