/**
 * Measures the board and reports the column bucket, not the pixel width.
 *
 * The bucket is the only measurement that changes the board: it picks the placement algorithm and
 * the number of columns tiles are packed into. Width beyond that only scales the columns, and the
 * renderer expresses that in CSS, so a pointer-driven window resize repaints without React seeing
 * a single state change. Reporting raw pixels here would re-run placement and re-render every tile
 * on every frame of a drag-resize for a result that is usually identical.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import { columnCountForWidth, FALLBACK_WIDTH } from "./metrics"

export interface BoardWidth<T extends HTMLElement> {
  /** Attach to the element whose content box defines the board's usable width. */
  ref: RefObject<T | null>
  columnCount: number
}

export function useBoardWidth<T extends HTMLElement = HTMLDivElement>(): BoardWidth<T> {
  const ref = useRef<T | null>(null)
  // The unmeasured board lays out at the fallback rather than at one column, so a wide board does
  // not paint stacked and then reflow once the observer answers.
  const [columnCount, setColumnCount] = useState(() => columnCountForWidth(FALLBACK_WIDTH))

  // A layout effect, not an effect: React flushes these before the browser paints, so the first
  // measurement corrects the fallback bucket in the same frame. Under a plain effect a narrow
  // window would paint a four-column board and snap to one a frame later, which is the flash the
  // fallback exists to avoid, just moved onto the other end of the range.
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return

    // A detached or display:none board reports 0, which is not a narrow board. Holding the last
    // bucket keeps a hidden route from re-bucketing to one column and reflowing on the way back.
    const apply = (width: number) => {
      if (width > 0) setColumnCount(columnCountForWidth(width))
    }

    // The observer's first callback arrives a frame late, and the element already has a width now.
    apply(element.clientWidth)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      // contentRect rather than borderBoxSize: the tile rects are laid out inside the padding box,
      // and a board that ever grows a border would otherwise bucket on width it cannot use.
      if (entry !== undefined) apply(entry.contentRect.width)
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, columnCount }
}
