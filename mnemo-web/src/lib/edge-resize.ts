import { restoreTextSelection, suppressTextSelection } from "@/lib/dnd/drag-select"

/**
 * Dragging a panel's edge to resize it.
 *
 * The arithmetic and the drag bookkeeping are separated because only the first is
 * interesting and only the second is easy to get subtly wrong: the cursor has to be
 * held on the body rather than on the target (once the pointer leaves the few pixels of
 * the strip mid-drag the strip's own cursor stops applying and the arrow flickers back),
 * text selection has to be suppressed for the length of the gesture, and the listeners
 * have to come off even when the component unmounts under the pointer.
 */

/** Which way the panel grows as the pointer moves. A right-hand panel grows leftward. */
export type ResizeGrowth = "left" | "right"

/**
 * The width an edge drag is asking for.
 *
 * `anchor` is the client x of the panel's fixed edge, the one that is not being dragged.
 */
export function widthFromPointer(anchor: number, clientX: number, growth: ResizeGrowth): number {
  return growth === "left" ? anchor - clientX : clientX - anchor
}

/** How far one arrow press moves an edge. Coarse enough to cross a range without holding it. */
export const RESIZE_KEYBOARD_STEP = 16

/**
 * The width an arrow key is asking for, or null when the key is not one of the two.
 *
 * Arrow left widens a right-hand panel and narrows a left-hand one, so the key always
 * moves the edge in the direction it points regardless of which side the panel is on.
 */
export function widthFromArrowKey(
  key: string,
  width: number,
  growth: ResizeGrowth,
  step: number = RESIZE_KEYBOARD_STEP,
): number | null {
  const sign = growth === "left" ? 1 : -1
  if (key === "ArrowLeft") return width + sign * step
  if (key === "ArrowRight") return width - sign * step
  return null
}

export interface EdgeResizeOptions {
  /** Client x of the edge that stays put for the length of the drag. */
  readonly anchor: number
  readonly growth: ResizeGrowth
  readonly onWidth: (width: number) => void
}

/**
 * Starts an edge drag and returns the stop it installs, so a caller that unmounts
 * mid-gesture can end it the same way a pointerup does.
 */
export function startEdgeResize({ anchor, growth, onWidth }: EdgeResizeOptions): () => void {
  const move = (event: PointerEvent) => onWidth(widthFromPointer(anchor, event.clientX, growth))
  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
    document.body.style.cursor = ""
    restoreTextSelection()
  }

  document.body.style.cursor = "col-resize"
  suppressTextSelection()
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", stop)
  return stop
}
