import { useSyncExternalStore } from "react"

import { fontEpoch } from "./fonts"

/**
 * The font epoch as React state: zero while the page's first fonts are still loading, and a new
 * number each time a later batch lands. A projection keyed on it waits for the first and re-runs
 * for the rest.
 */
export function useFontEpoch(): number {
  return useSyncExternalStore(fontEpoch.subscribe, fontEpoch.current)
}
