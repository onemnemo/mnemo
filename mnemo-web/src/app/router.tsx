import { useEffect, useSyncExternalStore } from "react"

import { DecksPage } from "@/pages/DecksPage"

const DEFAULT_ROUTE = "#/decks"

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange)
  return () => window.removeEventListener("hashchange", onStoreChange)
}

function getHash(): string {
  return window.location.hash
}

/** Current URL hash (e.g. "#/decks"), kept live via the `hashchange` event. */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getHash, getHash)
}

/**
 * Minimal hash-based route dispatch - no router dependency. Intentionally
 * tiny; a real router library is not worth it until there is more than
 * one real page.
 */
export function AppRouter() {
  const hash = useHashRoute()

  useEffect(() => {
    if (hash !== DEFAULT_ROUTE) {
      // Empty or unknown hash: normalize the address bar without growing
      // browser history.
      window.location.replace(DEFAULT_ROUTE)
    }
  }, [hash])

  switch (hash) {
    case DEFAULT_ROUTE:
      return <DecksPage />
    default:
      return <DecksPage />
  }
}
