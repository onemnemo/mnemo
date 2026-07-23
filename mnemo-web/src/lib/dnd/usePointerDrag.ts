import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

/**
 * The pointer state machine behind hand-rolled drag-and-drop. Press arms,
 * movement past the threshold starts the drag, and release commits the plan the
 * indicator was drawn from. It carries no notion of what is being dragged or
 * where it can land: a caller supplies `resolve` (pointer -> target), `plan`
 * (target -> the change it would make, or null for none) and `onDrop`, and the
 * hook owns only the plumbing every drag needs anyway - the two thresholds, the
 * ghost, the window listeners, Escape, the swallowed trailing click.
 *
 * Extracted from the flashcard library drag so the note-block reorder and, later,
 * the note tree can share one tested machine. Nothing domain-specific belongs in
 * this file; the moment a `folder` or a `block` type appears here it has leaked.
 */

export interface Point {
  x: number
  y: number
}

/** Pointer travel on either axis that turns a press into a drag rather than a click. */
export const DRAG_START_THRESHOLD = 5

/**
 * How far from the press the pointer must be before a drop registers at all.
 * Measured press-to-here rather than along the path, so dragging away and back
 * reads as "never mind" instead of committing on a slip. Nothing is painted below
 * this distance either: an indicator on screen always means the drop on release is
 * the one being shown.
 */
export const COMMIT_DISTANCE = 24

/** Where the ghost sits relative to the cursor, and how it is tilted. */
export interface GhostOptions<THandle> {
  /**
   * The ghost's top-left offset from the cursor. A bare point (or the default)
   * is capped at half the ghost's own size, which centres a small ghost on the
   * cursor; a function is honoured verbatim, for a ghost that should keep the
   * exact point it was grabbed by under the pointer.
   */
  offset?: Point | ((handle: THandle) => Point)
  /** The tilt that makes the ghost read as picked up rather than pasted on. */
  tiltDeg?: number
  /** Keep the ghost fully inside the window. On by default. */
  clampToViewport?: boolean
}

export interface PointerDragOptions<THandle, TTarget, TPlan> {
  /** Stable key for a handle, used only for the trailing-click suppression. */
  getKey: (handle: THandle) => string
  /**
   * Where this drag would land given the current pointer, or null for nowhere.
   * Called only once the pointer is past {@link COMMIT_DISTANCE}. The caller
   * closes over whatever it measures against (a surface, a list, a view), read
   * fresh on each call so a mid-drag refetch or scroll cannot stale it.
   */
  resolve: (pointer: Point, handle: THandle) => TTarget | null
  /**
   * What the drop would change, or null if nothing. Consulted on every move, so
   * an indicator is only ever drawn for a drop that has work to do.
   */
  plan: (handle: THandle, target: TTarget) => TPlan | null
  /** Runs the committed plan on release. */
  onDrop: (plan: TPlan) => void
  /** Structural compare so holding still over one target does not re-render. Defaults to Object.is. */
  sameTarget?: (a: TTarget | null, b: TTarget | null) => boolean
  /** A press whose target sits inside one of these is left to that element. */
  ignorePressWithin?: string
  readonly ghost?: GhostOptions<THandle>
  /** Pointer travel that arms the drag. Defaults to {@link DRAG_START_THRESHOLD}. */
  startThreshold?: number
  /** Travel before anything commits or paints. Defaults to {@link COMMIT_DISTANCE}. */
  commitDistance?: number
}

export interface PointerDrag<THandle, TTarget> {
  /** The handle being dragged, non-null exactly while a drag is on screen. */
  handle: THandle | null
  target: TTarget | null
  /** `getKey(handle)`, for a source element that fades itself out. */
  sourceKey: string | null
  ghostRef: RefObject<HTMLDivElement | null>
  /** Re-pins the ghost to the cursor. The layer calls this on mount so it never paints at 0,0. */
  placeGhost: () => void
  press: (event: ReactPointerEvent, handle: THandle) => void
  /**
   * Whether the click now arriving on `key` is the tail of a drag and should be
   * swallowed rather than treated as a plain click.
   */
  suppressClick: (key: string) => boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function defaultSameTarget<TTarget>(a: TTarget | null, b: TTarget | null): boolean {
  return Object.is(a, b)
}

interface Press<THandle> {
  pointerId: number
  handle: THandle
  at: Point
}

interface Active<THandle> {
  handle: THandle
}

export function usePointerDrag<THandle, TTarget, TPlan>(
  options: PointerDragOptions<THandle, TTarget, TPlan>,
): PointerDrag<THandle, TTarget> {
  const [handle, setHandle] = useState<THandle | null>(null)
  const [target, setTarget] = useState<TTarget | null>(null)

  const pressed = useRef<Press<THandle> | null>(null)
  const active = useRef<Active<THandle> | null>(null)
  const pointer = useRef<Point>({ x: 0, y: 0 })
  const targetRef = useRef<TTarget | null>(null)
  const plannedRef = useRef<TPlan | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const teardown = useRef<(() => void) | null>(null)
  /**
   * The handle key a drag ended on, cleared by the click it swallows or by the
   * next press. Keyed rather than a plain flag so a stray click elsewhere cannot
   * spend the suppression the dragged element is still waiting for.
   */
  const dragged = useRef<string | null>(null)

  // The window listeners live for one interaction, but a refetch or a re-render
  // can land mid-drag, so the values they read come from a ref rather than the
  // closure they were created in.
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const placeGhost = useCallback(() => {
    const ghost = ghostRef.current
    if (!ghost) return
    const dragging = active.current?.handle
    if (!dragging) return

    const ghostOptions = latest.current.ghost
    const offsetOption = ghostOptions?.offset
    const tiltDeg = ghostOptions?.tiltDeg ?? 0
    const clampToViewport = ghostOptions?.clampToViewport ?? true

    // Layout size, not the measured rect: the ghost may be tilted, and a rotated
    // bounding box would grow with the tilt and drift it away from the cursor.
    const width = ghost.offsetWidth
    const height = ghost.offsetHeight

    let offsetX: number
    let offsetY: number
    if (typeof offsetOption === "function") {
      // Honoured verbatim: a grabbed ghost keeps its grab point under the cursor.
      const raw = offsetOption(dragging)
      offsetX = raw.x
      offsetY = raw.y
    } else {
      // A small ghost centres on the cursor rather than hanging past its own edge.
      const base = offsetOption ?? { x: 24, y: 14 }
      offsetX = Math.min(base.x, width / 2)
      offsetY = Math.min(base.y, height / 2)
    }

    let left = pointer.current.x - offsetX
    let top = pointer.current.y - offsetY
    if (clampToViewport) {
      left = clamp(left, 0, window.innerWidth - width)
      top = clamp(top, 0, window.innerHeight - height)
    }
    ghost.style.transform = `translate3d(${String(left)}px, ${String(top)}px, 0) rotate(${String(tiltDeg)}deg)`
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

  // A drag outlives any single render but not the page: unmounting mid-drag must
  // strand neither the listeners nor the suppressed text selection, which is set
  // on the body and would otherwise leave the app unselectable until a reload.
  useEffect(
    () => () => {
      teardown.current?.()
      document.body.style.userSelect = ""
    },
    [],
  )

  const press = useCallback(
    (event: ReactPointerEvent, source: THandle) => {
      if (event.button !== 0 || teardown.current) return
      // Touch is left to the browser: a finger crosses the arm threshold well
      // inside the scroll slop, so a touch drag would raise the ghost and then
      // have the gesture taken away as a scroll a few pixels later.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return
      const ignore = latest.current.ignorePressWithin
      if (ignore && event.target instanceof Element && event.target.closest(ignore)) return

      const startThreshold = latest.current.startThreshold ?? DRAG_START_THRESHOLD
      const commitDistance = latest.current.commitDistance ?? COMMIT_DISTANCE

      dragged.current = null
      pressed.current = { pointerId: event.pointerId, handle: source, at: { x: event.clientX, y: event.clientY } }
      pointer.current = { x: event.clientX, y: event.clientY }

      const resolve = (): TTarget | null => {
        const dragging = active.current?.handle
        if (!dragging) return null
        return latest.current.resolve(pointer.current, dragging)
      }

      const syncTarget = () => {
        const from = pressed.current
        if (!from) return

        // Two things must hold before anything is drawn, so an indicator on
        // screen always means the drop it shows will happen on release. The
        // pointer must be far enough from the press to count - measured
        // press-to-here, so wandering back near the start withdraws it - and the
        // plan must have work to do.
        const travelled = Math.hypot(pointer.current.x - from.at.x, pointer.current.y - from.at.y)
        const resolved = travelled >= commitDistance ? resolve() : null
        const planned = resolved ? latest.current.plan(from.handle, resolved) : null
        const next = planned ? resolved : null
        const same = latest.current.sameTarget ?? defaultSameTarget

        plannedRef.current = planned
        targetRef.current = next
        setTarget((current) => (same(current, next) ? current : next))
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        pointer.current = { x: moveEvent.clientX, y: moveEvent.clientY }

        if (!active.current) {
          const from = pressed.current
          if (!from) return
          const movedX = Math.abs(moveEvent.clientX - from.at.x)
          const movedY = Math.abs(moveEvent.clientY - from.at.y)
          if (movedX <= startThreshold && movedY <= startThreshold) return

          active.current = { handle: from.handle }
          dragged.current = latest.current.getKey(from.handle)
          // Dragging across the page would otherwise sweep a text selection along.
          document.body.style.userSelect = "none"
          setHandle(from.handle)
        }

        placeGhost()
        syncTarget()
      }

      // Wheel-scrolling with the button held moves everything out from under an
      // indicator that no pointer event is coming to correct.
      const onScroll = () => {
        if (active.current) syncTarget()
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return

        const drag = active.current
        const planned = plannedRef.current
        const { onDrop } = latest.current
        finish()

        // The plan the indicator was drawn from, not a fresh one: what the user
        // saw is what runs.
        if (drag && planned) onDrop(planned)
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === event.pointerId) finish()
      }

      // A drag owns the keyboard while it is up, so app shortcuts cannot navigate
      // out from under it. Escape abandons it with the button still held; nothing
      // resets `dragged` there, so the trailing click is still swallowed.
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
    [finish, placeGhost],
  )

  const suppressClick = useCallback((key: string) => {
    if (dragged.current !== key) return false
    dragged.current = null
    return true
  }, [])

  return {
    handle,
    target,
    sourceKey: handle ? options.getKey(handle) : null,
    ghostRef,
    placeGhost,
    press,
    suppressClick,
  }
}
