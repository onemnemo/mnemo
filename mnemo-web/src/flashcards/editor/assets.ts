import { useAssetObjectUrl } from "@/api/asset-blob"
import { apiFetch } from "@/api/client"
import type { CardAssetDto } from "@/api/types"

/**
 * Uploads an image and returns the ids the editor needs to reference it. The file lands on disk
 * before the card is saved, the way the desktop copies a picked image the moment it is attached
 * - which is what lets the thumbnail appear straight away.
 */
export function uploadCardAsset(file: File): Promise<CardAssetDto> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<CardAssetDto>("/flashcards/assets", { method: "POST", body: form })
}

/** A blob URL for a card attachment, or null while it loads, on failure, or when unservable. */
export function useCardAssetUrl(assetId: string | null | undefined): string | null {
  return useAssetObjectUrl(assetId ? `/api/flashcards/assets/${encodeURIComponent(assetId)}` : null)
}
