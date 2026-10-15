import { useState } from "react"

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

/** The URL an img loads a card attachment from, or null when the card names no servable file. */
export function cardAssetUrl(assetId: string | null | undefined): string | null {
  return assetId ? `/api/flashcards/assets/${encodeURIComponent(assetId)}` : null
}

/** Whether the img showing `url` failed to load. A new url starts clean. */
export function useImageFailure(url: string | null): { failed: boolean; onError: () => void } {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return { failed: url !== null && failedUrl === url, onError: () => setFailedUrl(url) }
}

