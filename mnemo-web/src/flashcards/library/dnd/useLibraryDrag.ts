import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

import type { FolderDto } from "@/api/types"

import {
  COMMIT_DISTANCE,
  DRAG_START_THRESHOLD,
  resolveDropTarget,
  type Box,
  type DragHandle,
  type DropTarget,
  type MeasuredRow,
} from "./model"

// The pointer state machine behind library drag-and-drop. Press arms, movement past the
// threshold starts the drag, and release commits. Hand-rolled rather than pulled from a drag
// library: every decision here - the two thresholds, the bands inside a row, the subtree
// highlight - is custom anyway, so a library would only be supplying the event plumbing.

/** How far the ghost's top-left sits from the cursor; small ghosts centre on it instead. */
const GHOST_OFFSET_X = 24
const GHOST_OFFSET_Y = 14

/** The tilt that makes the ghost read as picked up rather than pasted onto the page. */
const GHOST_TILT_DEG = -1.5

interface Press {
  pointerId: number
  handle: DragHandle
  at: { x: number; y: number }
}

interface Active {
  handle: DragHandle
}

export interface LibraryDrag {
  /** The row being dragged. Rows fade themselves out by matching their own key against it. */
  sourceKey: string | null
  /** Non-null exactly while a drag is on screen; drives the ghost's contents. */
  handle: DragHandle | null
  target: DropTarget | null
  ghostRef: RefObject<HTMLDivElement | null>
  /** Re-pins the ghost to the cursor. The layer calls this on mount so it never paints at 0,0. */
  placeGhost: () => void
  press: (event: ReactPointerEvent, handle: DragHandle) => void
  /**
   * Whether the click now arriving on `key`'s row is the tail of a drag and should be
   * swallowed. A row that opens a deck or toggles a folder has to ask before acting.
   */
  suppressClick: (key: string) => boolean
}

/**
 * Row rectangles, read fresh on each move rather than cached at drag start. The list is short
 * and unvirtualized, and measuring live is what keeps the indicators honest when the page
 * scrolls under a held pointer.
 */
function measureRows(surface: HTMLElement): MeasuredRow[] {
  return Array.from(surface.querySelectorAll<HTMLElement>("[data-row-key]"), (element) => {
    const rect = element.getBoundingClientRect()
    return {
      key: element.dataset.rowKey ?? "",
      kind: element.dataset.rowKind === "folder" ? "folder" : "deck",
      id: element.dataset.rowId ?? "",
      depth: Number(element.dataset.rowDepth ?? 0),
      folderId: element.dataset.rowFolder || null,
      box: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    } satisfies MeasuredRow
  })
}

function sameBox(a: Box | undefined, b: Box | undefined): boolean {
  if (!a || !b) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/** Structural compare, so holding still over one target does not re-render the tree per move. */
function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.mode === b.mode &&
    a.folderId === b.folderId &&
    a.parentId === b.parentId &&
    sameBox(a.line, b.line) &&
    sameBox(a.highlight, b.highlight)
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function useLibraryDrag<TPlan>({
  surfaceRef,
  folders,
  plan,
  onDrop,
}: {
  surfaceRef: RefObject<HTMLElement | null>
  folders: readonly FolderDto[]
  /**
   * What this drop would actually change, or null if the answer is nothing. Consulted on every
   * move, so an indicator is only ever drawn for a drop that has work to do.
   */
  plan: (handle: DragHandle, target: DropTarget) => TPlan | null
  onDrop: (planned: TPlan) => void
}): LibraryDrag {
  const [handle, setHandle] = useState<DragHandle | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)

  const pressed = useRef<Press | null>(null)
  const active = useRef<Active | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const targetRef = useRef<DropTarget | null>(null)
  const plannedRef = useRef<TPlan | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const teardown = useRef<(() => void) | null>(null)
  /**
   * The row key a drag ended on, cleared by the click it swallows or by the next press. Keyed
   * rather than a plain flag so a stray click elsewhere - a second finger landing on another
   * row - cannot spend the suppression the dragged row is still waiting for.
   */
  const dragged = useRef<string | null>(null)

  // The window listeners live only for one interaction, but a refetch can land mid-drag, so
  // the values they read come from refs rather than the closure they were created in.
  const latest = useRef({ folders, plan, onDrop })
  useEffect(() => {
    latest.current = { folders, plan, onDrop }
  })

  const placeGhost = useCallback(() => {
    const ghost = ghostRef.current
    if (!ghost) return

    // Layout size, not the measured rect: the ghost is tilted, and a rotated bounding box would
    // grow with the tilt and drift the pill away from the cursor.
    const width = ghost.offsetWidth
    const height = ghost.offsetHeight
    const left = clamp(pointer.current.x - Math.min(GHOST_OFFSET_X, width / 2), 0, window.innerWidth - width)
    const top = clamp(pointer.current.y - Math.min(GHOST_OFFSET_Y, height / 2), 0, window.innerHeight - height)
    ghost.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${GHOST_TILT_DEG}deg)`
  }, [])

  const finish = useCallback(() => {
    teardown.current?.()
    teardown.current = null
    pressed.current = null
    active.current = null
    targetRef.current = null
    plannedRef.current = null
    document.body.style.userSelect = ""
    setHandle(null)
    setTarget(null)
  }, [])

  // A drag outlives any single render but not the page: navigating away mid-drag must strand
  // neither the listeners nor the suppressed text selection, which is set on the body and would
  // otherwise leave the whole app unselectable until a reload.
  useEffect(
    () => () => {
      teardown.current?.()
      document.body.style.userSelect = ""
    },
    [],
  )

  const press = useCallback(
    (event: ReactPointerEvent, source: DragHandle) => {
      if (event.button !== 0 || teardown.current) return
      // Touch is left to the browser. A finger crosses the 5px arm threshold well inside the
      // scroll slop, so a touch drag would raise the ghost and then have the gesture taken away
      // as a scroll a few pixels later; claiming the gesture instead would cost the ability to
      // scroll the list by dragging a row, which is worse than having no touch reorder.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return
      // Row menus and the inline rename box own their own presses.
      if (event.target instanceof Element && event.target.closest("button, input")) return

      dragged.current = null
      pressed.current = { pointerId: event.pointerId, handle: source, at: { x: event.clientX, y: event.clientY } }
      pointer.current = { x: event.clientX, y: event.clientY }

      const resolve = (): DropTarget | null => {
        const surface = surfaceRef.current
        const dragging = active.current?.handle
        if (!surface || !dragging) return null

        const rect = surface.getBoundingClientRect()
        return resolveDropTarget({
          pointer: pointer.current,
          rows: measureRows(surface),
          surface: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          source: dragging,
          folders: latest.current.folders,
        })
      }

      const syncTarget = () => {
        const from = pressed.current
        if (!from) return

        // Two things have to hold before anything is drawn, so that an indicator on screen
        // always means the drop it shows will happen on release. The pointer must be far enough
        // from the press to count - measured press-to-here, so wandering back near the start
        // withdraws it - and the drop must have work to do: "below the folder I already sit
        // under" resolves to a perfectly valid target that would write nothing.
        const travelled = Math.hypot(pointer.current.x - from.at.x, pointer.current.y - from.at.y)
        const resolved = travelled >= COMMIT_DISTANCE ? resolve() : null
        const planned = resolved ? latest.current.plan(from.handle, resolved) : null
        const next = planned ? resolved : null

        plannedRef.current = planned
        targetRef.current = next
        setTarget((current) => (sameTarget(current, next) ? current : next))
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        pointer.current = { x: moveEvent.clientX, y: moveEvent.clientY }

        if (!active.current) {
          const from = pressed.current
          if (!from) return
          const movedX = Math.abs(moveEvent.clientX - from.at.x)
          const movedY = Math.abs(moveEvent.clientY - from.at.y)
          if (movedX <= DRAG_START_THRESHOLD && movedY <= DRAG_START_THRESHOLD) return

          active.current = { handle: from.handle }
          dragged.current = from.handle.key
          // Dragging across rows would otherwise sweep a text selection along with the ghost.
          document.body.style.userSelect = "none"
          setHandle(from.handle)
        }

        placeGhost()
        syncTarget()
      }

      // Wheel-scrolling with the button held moves every row out from under an indicator that
      // no pointer event is coming to correct.
      const onScroll = () => {
        if (active.current) syncTarget()
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return

        const drag = active.current
        const planned = plannedRef.current
        const { onDrop } = latest.current
        finish()

        // The plan the indicator was drawn from, not a fresh one: what the user saw is what runs.
        if (drag && planned) onDrop(planned)
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === event.pointerId) finish()
      }

      // A drag owns the keyboard while it is up. Rows activate on Enter and Space and stay
      // focused under the pointer, so without this the row being dragged would open or collapse
      // mid-drag; app shortcuts would navigate out from under the drag entirely.
      //
      // Escape abandons it with the button still held. Nothing resets `dragged` there, so the
      // click that eventually follows the release is still swallowed rather than landing on
      // whichever row the pointer came to rest on.
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (!active.current) return
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        if (keyEvent.key === "Escape") finish()
      }

      // Right-clicking mid-drag would drop a menu on top of the ghost with no way to finish.
      const onContextMenu = (menuEvent: Event) => {
        if (active.current) menuEvent.preventDefault()
      }

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
    [finish, placeGhost, surfaceRef],
  )

  const suppressClick = useCallback((key: string) => {
    if (dragged.current !== key) return false
    dragged.current = null
    return true
  }, [])

  return {
    sourceKey: handle?.key ?? null,
    handle,
    target,
    ghostRef,
    placeGhost,
    press,
    suppressClick,
  }
}
