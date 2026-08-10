/**
 * The tile drag gesture.
 *
 * A live-layout drag, not a drop-indicator drag: the tile itself follows the pointer pixel for
 * pixel, the cell it would land in is written straight onto the draft as it moves, and the engine
 * re-resolves the whole board around it every frame. The drop simply keeps whatever the last move
 * produced. That is why `usePointerDrag` is not reused here despite being the port's shared drag
 * machine: it commits a plan on release, hides its target until the pointer has travelled a commit
 * distance, and has no way to restore state on cancel. All three are wrong for a board whose tiles
 * must follow the pointer from the first pixel and snap back to their origin cell on Escape.
 *
 * The board element is the only coordinate space involved, so pointer positions convert once and
 * serve both the free position and the cell targeting.
 */

import { useCallback, useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

import { flowIndexAt } from "../layout/compute"
import type { WidgetPlacement } from "../layout/engine"
import { cellWidthFor, GAP, MAX_COLUMNS } from "../layout/metrics"
import { useOverviewStore } from "../store"
import { getTargetCell, resolveCellWidth } from "./targeting"

/**
 * Pointer travel that turns a press on a tile into a drag. Compared per axis and exclusively,
 * which is not the same as a radius: a (4.5, 0) move starts a drag and a (4, 4) move does not.
 *
 * There is deliberately no commit distance. A commit distance exists to stop a nudge from
 * registering as a drop, but here the tile is already under the pointer by then, so all a dead
 * zone would buy is a stretch where the board visibly refuses to follow the cursor.
 */
export const DRAG_START_THRESHOLD = 4

export interface BoardDragMetrics {
  columnCount: number
  /** Rows the content occupies. Targeting allows one past this, which is how the board grows. */
  usedRows: number
  /** The current placements, so a narrow drop can work out where in flow order it landed. */
  placements: readonly WidgetPlacement[]
}

export interface BoardDrag {
  /** Attach to a tile. The whole tile is the handle; controls that must not drag stop the press. */
  onTilePointerDown: (event: ReactPointerEvent, instanceId: string) => void
}

interface Press {
  pointerId: number
  instanceId: string
  index: number
  columnSpan: number
  /** Where inside the tile the pointer grabbed it, so the tile does not jump under the cursor. */
  grabX: number
  grabY: number
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
    document.body.style.cursor = ""
  }, [])

  // A drag outlives a render but not the page. Unmounting mid-gesture must strand neither the
  // window listeners nor the suppressed text selection, which is set on the body and would
  // otherwise leave the app unselectable until a reload.
  useEffect(
    () => () => {
      teardown.current?.()
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    },
    [],
  )

  const syncToPointer = useCallback(() => {
    const board = boardRef.current
    const press = pressed.current
    if (board === null || press === null) return

    const rect = board.getBoundingClientRect()
    const { columnCount, usedRows } = latest.current
    const cellWidth = resolveCellWidth(cellWidthFor(rect.width, columnCount), columnCount)

    // The tile's own top-left, which is what both the free position and the target cell read.
    const span = Math.min(press.columnSpan, columnCount)
    const maxX = Math.max(0, rect.width - (span * cellWidth + (span - 1) * GAP))
    const x = Math.min(maxX, Math.max(0, pointer.current.x - rect.left - press.grabX))
    const y = Math.max(0, pointer.current.y - rect.top - press.grabY)

    const cell = getTargetCell({ x, y }, cellWidth, columnCount, usedRows, press.columnSpan)
    const store = useOverviewStore.getState()
    store.updateDragTarget(cell.column, cell.row)
    store.updateDragPosition(x, y)
  }, [boardRef])

  const onTilePointerDown = useCallback(
    (event: ReactPointerEvent, instanceId: string) => {
      if (event.button !== 0 || teardown.current !== null) return
      // Touch is left to the browser, as it is everywhere else in the port: a finger crosses a 4px
      // threshold well inside the scroll slop, so a touch drag would raise the tile and then have
      // the gesture taken away as a page scroll a few pixels later.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return

      const board = boardRef.current
      if (board === null) return

      const store = useOverviewStore.getState()
      const index = store.draft.findIndex((widget) => widget.instanceId === instanceId)
      if (index < 0) return

      const tile = (event.currentTarget as HTMLElement).getBoundingClientRect()
      pressed.current = {
        pointerId: event.pointerId,
        instanceId,
        index,
        columnSpan: store.draft[index].size.columns,
        grabX: event.clientX - tile.left,
        grabY: event.clientY - tile.top,
        x: event.clientX,
        y: event.clientY,
      }
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
          document.body.style.cursor = "grabbing"
          useOverviewStore.getState().beginDrag(from.instanceId)
        }

        syncToPointer()
      }

      // Wheel-scrolling with the button held moves the board out from under a pointer that is not
      // going to send another move event to correct the target.
      const onScroll = () => {
        if (dragging.current) syncToPointer()
      }

      const onUp = (upEvent: PointerEvent) => {
        const from = pressed.current
        if (from === null || upEvent.pointerId !== from.pointerId) return

        const wasDragging = dragging.current
        const { columnCount, placements } = latest.current
        const dropped = useOverviewStore.getState().draft.find((widget) => widget.instanceId === from.instanceId)
        finish()

        // A press that never crossed the threshold does nothing at all, not even a same-cell drop.
        if (!wasDragging) return

        if (columnCount >= MAX_COLUMNS || dropped === undefined) {
          useOverviewStore.getState().completeDrag()
          return
        }
        useOverviewStore
          .getState()
          .completeDrag(flowIndexAt(placements, from.index, dropped.column, dropped.row))
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

      // Right-clicking mid-drag would drop a menu over the tile with no way to finish the gesture.
      const onContextMenu = (menuEvent: Event) => {
        if (dragging.current) menuEvent.preventDefault()
      }

      // On the window, and no explicit pointer capture, which is what every other drag in the app
      // does. Capture on the board would buy only the release-outside-the-window case, and a mouse
      // button pressed inside the page already has that from the browser.
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
    [boardRef, finish, syncToPointer],
  )

  return { onTilePointerDown }
}
