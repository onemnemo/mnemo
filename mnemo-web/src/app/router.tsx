import { useEffect, useSyncExternalStore } from "react"

import { DEFAULT_ROUTE } from "@/app/routes"
import { getSettingValue } from "@/settings/store"

/**
 * The route the window was last on.
 *
 * localStorage rather than a stored setting: it is written on every navigation, and a
 * request per route change to remember something only this machine's next launch cares
 * about is not a trade worth making.
 */
const LAST_ROUTE_KEY = "mnemo.last-route"

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

/** Navigates to a route hash, the way the address bar holds it ("#/settings"). */
export function navigateTo(hash: string): void {
  window.location.hash = hash
}

/** Navigates to a route key, appending any path parameters ("flashcard-deck", id). */
export function navigate(key: string, ...params: readonly string[]): void {
  navigateTo(["#", key, ...params].join("/"))
}

/**
 * Normalizes an empty hash to the landing route once on mount, without growing browser
 * history, and remembers where the window ends up. Unknown routes are handled by
 * resolveRoute (falls back to the default page) so a wrong hash never blanks the shell.
 */
export function useRouteNormalization(): void {
  const hash = useHashRoute()

  useEffect(() => {
    if (hash === "" || hash === "#" || hash === "#/") {
      window.location.replace(`#/${landingRoute()}`)
      return
    }

    // Only real hashes are remembered, so the empty one this effect is about to replace
    // never becomes the thing the next launch resumes.
    try {
      localStorage.setItem(LAST_ROUTE_KEY, hash)
    } catch {
      // Non-fatal: the next launch opens on the default route instead.
    }
  }, [hash])
}

/**
 * Where a launch lands, per the App.OpenTo preference.
 *
 * Read once, not subscribed to: it decides what to do with an empty hash, and by the
 * time the setting could change the window is already somewhere.
 */
function landingRoute(): string {
  const preference = getSettingValue("App.OpenTo", "last")
  if (preference !== "last") return preference

  const stored = readLastRoute()
  if (stored) return stored.replace(/^#\/?/, "")
  return DEFAULT_ROUTE
}

/**
 * The hash this window was last on ("#/notes/abc"), or null when nothing is remembered.
 *
 * A whole hash rather than a route key, so resuming keeps the note that was open and not
 * merely the module it was in. Exported for the prefetch, which warms that route's code
 * before the shell gets around to asking for it.
 */
export function readLastRoute(): string | null {
  try {
    return localStorage.getItem(LAST_ROUTE_KEY)
  } catch {
    // Non-fatal: the caller falls back to the default route.
    return null
  }
}
