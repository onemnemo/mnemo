/**
 * The tile drag gesture, ported from OverviewView.axaml.cs.
 *
 * This is a live-layout drag, not a drop-indicator drag: every pointer move writes the target cell
 * straight onto the dragged tile, the engine re-resolves the whole board around it, and the drop
 * simply keeps whatever cell the last move produced. That is why `usePointerDrag` is not reused
 * here despite being the port's shared drag machine. It commits a plan on release, hides its target
 * until the pointer has travelled a commit distance, and has no way to restore state on cancel:
 * all three are wrong for a board whose tiles must follow the pointer from the first pixel and snap
 * back to their origin cell on Escape.
 *
 * The board element is the only coordinate space involved. The desktop has two, because its ghost
 * lives in the outer container and its targeting measures the inner items panel; in the port those
 * are one element, so pointer positions convert once and serve both.
 */

import { useCallback, useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

import { cellWidthFor } from "../layout/metrics"
import { useOverviewStore } from "../store"
import { getTargetCell, resolveCellWidth } from "./targeting"

/**
 * Pointer travel that turns a press on the handle into a drag. Compared per axis and exclusively,
 * which is not the same as a radius: a (4.5, 0) move starts a drag and a (4, 4) move does not.
 *
 * There is deliberately no commit distance, unlike `usePointerDrag`. A commit distance exists to
 * stop a nudge from registering as a drop, but here the tile is already under the pointer by then,
 * so all a dead zone would buy is a stretch where the board visibly refuses to follow the cursor.
 */
export const DRAG_START_THRESHOLD = 4

/** How far below-right of the cursor the ghost floats, on both axes. */
export const GHOST_POINTER_OFFSET = 14

export interface BoardDragMetrics {
  columnCount: number
  /** Rows the content occupies. Targeting allows one past this, which is how the board grows. */
  usedRows: number
}

export interface BoardDrag {
  /** Attach to a tile's drag handle. Nothing else on the tile may start a drag. */
  onHandlePointerDown: (event: ReactPointerEvent, instanceId: string, title: string) => void
}

interface Press {
  pointerId: number
  instanceId: string
  title: string
  /** Where the press landed, in client coordinates, for the threshold comparison. */
  x: number
  y: number
}

export function useBoardDrag(boardRef: RefObject<HTMLElement | null>, metrics: BoardDragMetrics): BoardDrag {
  const pressed = useRef<Press | null>(null)
  const dragging = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const teardown = useRef<(() => void) | null>(null)

  // Read when the pointer moves rather than when the listener was created: a window resize or a
  // reflow can land mid-drag, and the gesture has to aim at the grid that is on screen now.
  const latest = useRef(metrics)
  useEffect(() => {
    latest.current = metrics
  })

  const finish = useCallback(() => {
    teardown.current?.()
    teardown.current = null
    pressed.current = null
    dragging.current = false
    document.body.style.userSelect = ""
  }, [])

  // A drag outlives a render but not the page. Unmounting mid-gesture must strand neither the
  // window listeners nor the suppressed text selection, which is set on the body and would
  // otherwise leave the app unselectable until a reload.
  useEffect(
    () => () => {
      teardown.current?.()
      document.body.style.userSelect = ""
    },
    [],
  )

  const syncToPointer = useCallback(() => {
    const board = boardRef.current
    if (board === null) return

    const rect = board.getBoundingClientRect()
    const { columnCount, usedRows } = latest.current
    const cellWidth = resolveCellWidth(cellWidthFor(rect.width, columnCount), columnCount)
    const local = { x: pointer.current.x - rect.left, y: pointer.current.y - rect.top }

    const cell = getTargetCell(local, cellWidth, columnCount, usedRows)
    const store = useOverviewStore.getState()
    store.updateDragTarget(cell.column, cell.row)
    store.updateGhostPosition(local.x + GHOST_POINTER_OFFSET, local.y + GHOST_POINTER_OFFSET)
  }, [boardRef])

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent, instanceId: string, title: string) => {
      if (event.button !== 0 || teardown.current !== null) return
      // Touch is left to the browser, as it is everywhere else in the port: a finger crosses a 4px
      // threshold well inside the scroll slop, so a touch drag would raise the ghost and then have
      // the gesture taken away as a page scroll a few pixels later.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return

      pressed.current = { pointerId: event.pointerId, instanceId, title, x: event.clientX, y: event.clientY }
      pointer.current = { x: event.clientX, y: event.clientY }

      const onMove = (moveEvent: PointerEvent) => {
        const from = pressed.current
        if (from === null || moveEvent.pointerId !== from.pointerId) return
        pointer.current = { x: moveEvent.clientX, y: moveEvent.clientY }

        if (!dragging.current) {
          const movedX = Math.abs(moveEvent.clientX - from.x)
          const movedY = Math.abs(moveEvent.clientY - from.y)
          if (movedX <= DRAG_START_THRESHOLD && movedY <= DRAG_START_THRESHOLD) return

          dragging.current = true
          // Dragging across the page would otherwise sweep a text selection along with it.
          document.body.style.userSelect = "none"
          useOverviewStore.getState().beginDrag(from.instanceId, from.title)
        }

        syncToPointer()
      }

      // Wheel-scrolling with the button held moves the board out from under a pointer that is not
      // going to send another move event to correct the target.
      const onScroll = () => {
        if (dragging.current) syncToPointer()
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pressed.current?.pointerId) return
        const wasDragging = dragging.current
        finish()
        // A press that never crossed the threshold does nothing at all, not even a same-cell drop.
        if (wasDragging) useOverviewStore.getState().completeDrag()
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pressed.current?.pointerId) return
        const wasDragging = dragging.current
        finish()
        // The capture-loss path: the gesture was taken away rather than released, so the tile goes
        // back to the cell it was picked up from rather than landing wherever it happened to be.
        if (wasDragging) useOverviewStore.getState().cancelDrag()
      }

      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (!dragging.current) return
        // A live drag owns the keyboard, so an app shortcut cannot navigate out from under it. It
        // is also what stops the page's own Escape from ending the whole edit session: this runs in
        // the capture phase, before any bubble-phase listener on the window.
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        if (keyEvent.key !== "Escape") return

        useOverviewStore.getState().cancelDrag()
        finish()
      }

      // Right-clicking mid-drag would drop a menu over the ghost with no way to finish the gesture.
      const onContextMenu = (menuEvent: Event) => {
        if (dragging.current) menuEvent.preventDefault()
      }

      // On the window, and no explicit pointer capture, which is what every other drag in the app
      // does. Capture on the tile is not an option anyway: its card is replaced by the drop slot the
      // moment the drag starts, so the captured element would be destroyed mid-gesture. Capture on
      // the board would buy only the release-outside-the-window case, and a mouse button pressed
      // inside the page already has that from the browser.
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
      window.addEventListener("keydown", onKeyDown, true)
      window.addEventListener("contextmenu", onContextMenu, true)
      window.addEventListener("scroll", onScroll, true)

      teardown.current = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("keydown", onKeyDown, true)
        window.removeEventListener("contextmenu", onContextMenu, true)
        window.removeEventListener("scroll", onScroll, true)
      }
    },
    [finish, syncToPointer],
  )

  return { onHandlePointerDown }
}
