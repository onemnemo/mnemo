import { useEffect, useState } from "react"

import { apiToken } from "./client"

// Asset bytes live behind the /api bearer token, which a bare <img src> cannot carry. So we
// fetch them with the auth header and hand the element a blob URL instead. Chat attachments and
// card attachments are different routes over the same problem, so the mechanics live here.

/** Fetches an asset's bytes with the bearer header. Rejects on a non-OK status. */
export async function fetchAssetBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const headers = new Headers()
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(path, { headers, signal })
  if (!response.ok) throw new Error(`Asset ${path} failed (${response.status})`)

  return response.blob()
}

/** Fetches an asset's bytes with the bearer header and returns an object URL for them. */
export async function fetchAssetBlobUrl(path: string, signal?: AbortSignal): Promise<string> {
  return URL.createObjectURL(await fetchAssetBlob(path, signal))
}

/**
 * Loads an asset's bytes and exposes a blob URL for an <img>, revoking it when the path changes
 * or the component unmounts. Returns null until the bytes arrive, and on failure - callers show
 * a placeholder rather than a broken image.
 */
export function useAssetObjectUrl(path: string | null | undefined): string | null {
  return useAssetObject(path).url
}

export interface AssetObject {
  url: string | null
  /** True once the fetch has failed, so a caller can tell a dead asset from one still loading. */
  failed: boolean
}

/** {@link useAssetObjectUrl}, plus whether the fetch failed. */
export function useAssetObject(path: string | null | undefined): AssetObject {
  const [state, setState] = useState<AssetObject & { path: string | null | undefined }>({ path, url: null, failed: false })
  if (state.path !== path) setState({ path, url: null, failed: false })

  useEffect(() => {
    if (!path) return
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
        setState({ path, url: next, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ path, url: null, failed: true })
      })

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return state.path === path ? { url: state.url, failed: state.failed } : { url: null, failed: false }
}
