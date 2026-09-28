import { useEffect, useRef } from "react"

import { isModalOpen } from "@/lib/modal"
import { isNativeKeyRefusal } from "@/lib/native-keys"

/**
 * Keys pressed while nothing has the focus, handed to the map. A toolbar button leaves the focus
 * where it was, so a map worked only from the toolbar has it on the page, where no route handler
 * hears a key. Tab stays the page's, and so does a chord while page text is selected.
 */
export function usePageKeys(handler: (event: KeyboardEvent) => void): void {
  const live = useRef(handler)
  live.current = handler

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPageKey(event)) {
        return
      }
      live.current(event)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

/** Aimed at the page, and not already answered, not under a dialog, and not the page's own. */
export function isPageKey(event: KeyboardEvent): boolean {
  if (event.target !== document.body || event.key === "Tab" || isModalOpen()) {
    return false
  }
  if (event.defaultPrevented && !isNativeKeyRefusal(event)) {
    return false
  }
  const chord = event.ctrlKey || event.metaKey
  return !(chord && window.getSelection()?.isCollapsed === false)
}
