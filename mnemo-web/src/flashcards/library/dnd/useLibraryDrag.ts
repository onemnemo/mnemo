import { useCallback } from "react"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

import { usePointerDrag } from "@/lib/dnd/usePointerDrag"
import type { Point } from "@/lib/dnd/usePointerDrag"

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

// The library's drag surface: what to measure (folder/deck rows) and where a drop
// may land (`resolveDropTarget`). The pointer state machine underneath -  the two
// thresholds, the ghost, Escape, the swallowed trailing click - is the shared
// `usePointerDrag`; only the geometry and the legality rules live here.

/** How far the ghost's top-left sits from the cursor; small ghosts centre on it instead. */
const GHOST_OFFSET_X = 24
const GHOST_OFFSET_Y = 14

/** The tilt that makes the ghost read as picked up rather than pasted onto the page. */
const GHOST_TILT_DEG = -1.5

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
  // Read fresh on every move: a refetch can replace the folder list mid-drag, and
  // the resolver's legality rules have to see the current tree, not the one the
  // press closed over.
  const resolve = useCallback(
    (pointer: Point, source: DragHandle): DropTarget | null => {
      const surface = surfaceRef.current
      if (!surface) return null
      const rect = surface.getBoundingClientRect()
      return resolveDropTarget({
        pointer,
        rows: measureRows(surface),
        surface: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        source,
        folders,
      })
    },
    [surfaceRef, folders],
  )

  const drag = usePointerDrag<DragHandle, DropTarget, TPlan>({
    getKey: (handle) => handle.key,
    // Row menus and the inline rename box own their own presses.
    ignorePressWithin: "button, input",
    ghost: { offset: { x: GHOST_OFFSET_X, y: GHOST_OFFSET_Y }, tiltDeg: GHOST_TILT_DEG },
    startThreshold: DRAG_START_THRESHOLD,
    commitDistance: COMMIT_DISTANCE,
    sameTarget,
    resolve,
    plan,
    onDrop,
  })

  return {
    sourceKey: drag.sourceKey,
    handle: drag.handle,
    target: drag.target,
    ghostRef: drag.ghostRef,
    placeGhost: drag.placeGhost,
    press: drag.press,
    suppressClick: drag.suppressClick,
  }
}
