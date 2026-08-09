import { useEffect, type RefObject } from "react"

import { reportDragRegion } from "@/lib/window"

/**
 * Publishes an element's bounds as the window's Linux drag rectangle.
 *
 * Only Linux reads it, and it can only be a rectangle, which is why this points
 * at one deliberately empty strip instead of the whole titlebar: whatever the
 * rectangle covers stops being clickable, because GTK takes the press before the
 * webview sees it. The topbar is full of controls; the brand row is not.
 *
 * Elsewhere this costs one no-op message per layout change.
 */
export function useDragRegion(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const report = () => {
      const box = element.getBoundingClientRect()
      reportDragRegion({
        // Measured down from the top of the webview, so the handle's bottom edge
        // is the height whenever it starts at the top, which it does.
        height: box.bottom,
        left: box.left,
        right: window.innerWidth - box.right,
      })
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    // The right inset is relative to the window, so a resize moves it even when
    // the handle itself has not changed size.
    observer.observe(document.documentElement)
    return () => observer.disconnect()
  }, [ref])
}
