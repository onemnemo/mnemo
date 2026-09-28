import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"

import type { Point } from "../../model/scene"
import {
  edgeForArrow,
  fitsEdge,
  nearestEdge,
  resolveEdge,
  type CornerReserve,
  type DockEdge,
  type Size,
} from "./placement"

const EDGES: readonly DockEdge[] = ["bottom", "top", "left", "right"]
/** How far the grip has to travel before a press becomes a carry. */
const LIFT_DISTANCE = 4
const EMPTY: Size = { width: 0, height: 0 }

export interface ToolbarDrag {
  /** The pointer, in pane pixels. */
  readonly point: Point
  readonly target: DockEdge
}

export interface ToolbarDock {
  readonly pane: Size
  readonly reserve: CornerReserve
  /** The edge the bar sits on: the stored one, or the bottom when the stored one has no room. */
  readonly edge: DockEdge
  readonly allowed: readonly DockEdge[]
  readonly drag: ToolbarDrag | null
  /** Whether moves to the dock position glide, which is every move after the bar's first placement. */
  readonly settling: boolean
  readonly onGripPointerDown: (event: React.PointerEvent) => void
  readonly onGripKeyDown: (event: React.KeyboardEvent) => void
}

export interface ToolbarDockInput {
  /** The pane the bar floats over. It takes the pointer capture while the bar is carried. */
  readonly stage: RefObject<HTMLElement | null>
  /** The chrome in the bottom-right corner the bar has to keep clear of. */
  readonly corner: RefObject<HTMLElement | null>
  readonly stored: DockEdge
  readonly onStore: (edge: DockEdge) => void
  /** The bar's length with nothing open inside it, which is what decides whether an edge fits. */
  readonly length: number
}

/**
 * Where the bar is docked, and carrying it to another edge. The capture goes on the pane rather than
 * the grip, so the release is heard however the bar moved under the pointer.
 */
export function useToolbarDock({ stage, corner, stored, onStore, length }: ToolbarDockInput): ToolbarDock {
  const [pane, setPane] = useState<Size>(EMPTY)
  const [reserve, setReserve] = useState<CornerReserve>(EMPTY)
  const [drag, setDrag] = useState<ToolbarDrag | null>(null)
  const [settling, setSettling] = useState(false)

  // Placed without motion the first time, then gliding from there, so opening a map does not show
  // the bar flying in from the pane's corner.
  useEffect(() => {
    if (settling || pane.width === 0) {
      return
    }
    const frame = requestAnimationFrame(() => setSettling(true))
    return () => cancelAnimationFrame(frame)
  }, [settling, pane.width])

  // Passive rather than a layout effect: the pane and the corner are the bar's parent and sibling,
  // and their refs are not attached yet when a child's layout effects run.
  useEffect(() => {
    const host = stage.current
    if (!host) {
      return
    }
    const measure = () => {
      const rect = host.getBoundingClientRect()
      setPane((was) =>
        was.width === rect.width && was.height === rect.height ? was : { width: rect.width, height: rect.height },
      )
      const block = corner.current?.getBoundingClientRect()
      const next =
        block && block.width > 0 && block.height > 0
          ? { width: rect.right - block.left, height: rect.bottom - block.top }
          : EMPTY
      setReserve((was) => (was.width === next.width && was.height === next.height ? was : next))
    }
    measure()
    if (typeof ResizeObserver === "undefined") {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    if (corner.current) {
      observer.observe(corner.current)
    }
    return () => observer.disconnect()
  }, [stage, corner])

  const allowed = useMemo(
    () => EDGES.filter((edge) => fitsEdge(edge, pane, length, reserve)),
    [pane, length, reserve],
  )
  const edge = resolveEdge(stored, pane, length, reserve)

  const live = useRef({ allowed, onStore })
  live.current = { allowed, onStore }
  /** Ends the carry in progress, if there is one, without docking anywhere. */
  const abandon = useRef<(() => void) | null>(null)

  useEffect(() => () => abandon.current?.(), [])

  const onGripPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const host = stage.current
      if (event.button !== 0 || !host || abandon.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()

      const pointerId = event.pointerId
      const toPane = (clientX: number, clientY: number): Point => {
        const rect = host.getBoundingClientRect()
        return { x: clientX - rect.left, y: clientY - rect.top }
      }
      const targetAt = (point: Point) => {
        const rect = host.getBoundingClientRect()
        return nearestEdge(point, { width: rect.width, height: rect.height }, live.current.allowed)
      }

      const start = toPane(event.clientX, event.clientY)
      // Nothing is lifted until the pointer travels, so a click on the grip leaves the bar where it is.
      let current: ToolbarDrag | null = null

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) {
          return
        }
        const point = toPane(move.clientX, move.clientY)
        if (!current && Math.hypot(point.x - start.x, point.y - start.y) < LIFT_DISTANCE) {
          return
        }
        current = { point, target: targetAt(point) }
        setDrag(current)
      }
      const stop = () => {
        abandon.current = null
        host.removeEventListener("pointermove", onMove)
        host.removeEventListener("pointerup", finish)
        host.removeEventListener("pointercancel", cancel)
        host.removeEventListener("lostpointercapture", finish)
        if (host.hasPointerCapture?.(pointerId)) {
          host.releasePointerCapture(pointerId)
        }
        setDrag(null)
      }
      const finish = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) {
          return
        }
        const dropped = current
        stop()
        if (dropped) {
          live.current.onStore(dropped.target)
        }
      }
      const cancel = (end: PointerEvent) => {
        if (end.pointerId === pointerId) {
          stop()
        }
      }

      abandon.current = stop
      host.setPointerCapture?.(pointerId)
      host.addEventListener("pointermove", onMove)
      host.addEventListener("pointerup", finish)
      host.addEventListener("pointercancel", cancel)
      host.addEventListener("lostpointercapture", finish)
    },
    [stage],
  )

  const onGripKeyDown = useCallback((event: React.KeyboardEvent) => {
    const next = edgeForArrow(event.key)
    if (!next) {
      return
    }
    // The grip owns all four arrows, so the toolbar's own arrow walk never sees them.
    event.preventDefault()
    event.stopPropagation()
    if (live.current.allowed.includes(next)) {
      live.current.onStore(next)
    }
  }, [])

  return { pane, reserve, edge, allowed, drag, settling, onGripPointerDown, onGripKeyDown }
}
