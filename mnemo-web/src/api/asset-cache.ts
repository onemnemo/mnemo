// A session-scoped cache of asset object URLs, for imperative (non-React) consumers such as
// editor NodeViews. `useAssetObjectUrl` gives one component one URL and revokes it on unmount;
// a document full of NodeViews needs the complement: the same asset fetched once no matter how
// many views show it or how often undo/redo rebuilds them, and every URL revoked together when
// the owning session closes. Loader injected so any module's fetch route can sit behind it.

export interface AssetUrlCache {
  /**
   * The object URL for a reference, fetched at most once per reference. Rejects when the
   * loader does; a failed load is forgotten so a retry can attempt it again.
   */
  load(reference: string): Promise<string>
  /** Revokes every URL this cache handed out. Loads after this reject. */
  destroy(): void
}

export function createAssetUrlCache(loader: (reference: string) => Promise<string>): AssetUrlCache {
  const entries = new Map<string, Promise<string>>()
  let destroyed = false

  return {
    load(reference: string): Promise<string> {
      if (destroyed) return Promise.reject(new Error("Asset cache destroyed"))

      const existing = entries.get(reference)
      if (existing) return existing

      const entry = loader(reference).then(
        (url) => {
          // Settled after the session ended: nothing will ever read this URL, and destroy()
          // already ran its revocations, so this one is ours to release.
          if (destroyed) {
            URL.revokeObjectURL(url)
            throw new Error("Asset cache destroyed")
          }
          return url
        },
        (error: unknown) => {
          entries.delete(reference)
          throw error
        },
      )
      entries.set(reference, entry)
      return entry
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      for (const entry of entries.values()) {
        entry.then(
          (url) => URL.revokeObjectURL(url),
          () => {},
        )
      }
      entries.clear()
    },
  }
}
