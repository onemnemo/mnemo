import { useEffect, useState } from "react"

import { apiToken } from "@/api/client"

// Chat asset bytes live behind the /api bearer token, which a bare <img src> cannot
// carry. So we fetch the bytes with the auth header and hand the element a blob URL.

/** Fetches an asset's bytes with the bearer header and returns an object URL for it. */
export async function fetchAssetBlobUrl(assetId: string, signal?: AbortSignal): Promise<string> {
  const headers = new Headers()
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/chat/assets/${encodeURIComponent(assetId)}`, { headers, signal })
  if (!response.ok) throw new Error(`Asset ${assetId} failed (${response.status})`)

  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

/**
 * Loads an asset's bytes and exposes a blob URL for an <img>, revoking it when the asset
 * changes or the component unmounts. Returns null until the bytes arrive (or on failure).
 */
export function useAssetObjectUrl(assetId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!assetId) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    const controller = new AbortController()

    fetchAssetBlobUrl(assetId, controller.signal)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        objectUrl = next
        setUrl(next)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetId])

  return url
}
