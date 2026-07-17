import { useEffect, useSyncExternalStore } from "react"

import { DEFAULT_ROUTE } from "@/app/routes"

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange)
  return () => window.removeEventListener("hashchange", onStoreChange)
}

function getHash(): string {
  return window.location.hash
}

/** Current URL hash (e.g. "#/mindmap/abc"), kept live via `hashchange`. */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getHash, getHash)
}

/**
 * Normalizes an empty hash to the default route once on mount, without growing
 * browser history. Unknown routes are handled by resolveRoute (falls back to the
 * default page) so a wrong hash never blanks the shell.
 */
export function useRouteNormalization(): void {
  const hash = useHashRoute()
  useEffect(() => {
    if (hash === "" || hash === "#" || hash === "#/") {
      window.location.replace(`#/${DEFAULT_ROUTE}`)
    }
  }, [hash])
}
