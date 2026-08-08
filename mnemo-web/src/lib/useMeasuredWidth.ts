/**
 * The rendered width of an element, in pixels.
 *
 * For the handful of things that cannot be sized in CSS because they draw at fixed coordinates:
 * an SVG needs a real number for its viewBox, and a chart stretched with preserveAspectRatio
 * would distort its own stroke instead of redrawing at the new width.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react"

export interface MeasuredWidth<T extends HTMLElement> {
  ref: RefObject<T | null>
  /** Zero until the first measurement, which lands before the browser paints. */
  width: number
}

export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(): MeasuredWidth<T> {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  // A layout effect, so the first real width is in place for the same frame the element appears
  // in. Under a plain effect the drawing would paint once at zero and then jump.
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return

    // A hidden or detached element measures 0, which is not a width. Keeping the last one stops a
    // route the user navigated away from from resetting and redrawing on the way back.
    const apply = (measured: number) => {
      if (measured > 0) setWidth(measured)
    }

    // The observer's first callback is a frame late and the element already has a width now.
    apply(element.clientWidth)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) apply(entry.contentRect.width)
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
