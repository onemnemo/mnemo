import { useEffect, useState } from "react"

import { apiToken } from "./client"

// Asset bytes live behind the /api bearer token, which a bare <img src> cannot carry. So we
// fetch them with the auth header and hand the element a blob URL instead. Chat attachments and
// card attachments are different routes over the same problem, so the mechanics live here.

/** Fetches an asset's bytes with the bearer header and returns an object URL for them. */
export async function fetchAssetBlobUrl(path: string, signal?: AbortSignal): Promise<string> {
  const headers = new Headers()
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(path, { headers, signal })
  if (!response.ok) throw new Error(`Asset ${path} failed (${response.status})`)

  return URL.createObjectURL(await response.blob())
}

/**
 * Loads an asset's bytes and exposes a blob URL for an <img>, revoking it when the path changes
 * or the component unmounts. Returns null until the bytes arrive, and on failure - callers show
 * a placeholder rather than a broken image.
 */
export function useAssetObjectUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    const controller = new AbortController()

    fetchAssetBlobUrl(path, controller.signal)
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
  }, [path])

  return url
}
