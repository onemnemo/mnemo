/**
 * The rendered width of an element, in pixels.
 *
 * For the handful of things that cannot be sized in CSS because they draw at fixed coordinates:
 * an SVG needs a real number for its viewBox, and a chart stretched with preserveAspectRatio
 * would distort its own stroke instead of redrawing at the new width.
 */

import { useCallback, useRef, useState } from "react"

export interface MeasuredWidth<T extends HTMLElement> {
  /**
   * Attach to the element to measure. A callback ref rather than an object one, because the
   * elements that need measuring are usually the ones a component only renders once its data has
   * arrived: an effect that ran at mount would have found nothing there and never looked again.
   */
  ref: (element: T | null) => void
  /** Zero until the element attaches, which happens before the browser paints it. */
  width: number
}

export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(): MeasuredWidth<T> {
  const [width, setWidth] = useState(0)
  const watching = useRef<ResizeObserver | null>(null)

  const ref = useCallback((element: T | null) => {
    watching.current?.disconnect()
    watching.current = null
    // Called with null when the element goes away, which is also how this cleans up on unmount.
    if (element === null) return

    // A hidden or detached element measures 0, which is not a width. Keeping the last one stops a
    // route the user navigated away from from resetting and redrawing on the way back.
    const apply = (measured: number) => {
      if (measured > 0) setWidth(measured)
    }

    // The observer's first callback is a frame late, and reading here forces the layout that
    // gives the right answer now.
    apply(element.clientWidth)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) apply(entry.contentRect.width)
    })

    observer.observe(element)
    watching.current = observer
  }, [])

  return { ref, width }
}
