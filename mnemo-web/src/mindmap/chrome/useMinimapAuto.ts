import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react"

import type { CanvasRuntime } from "../canvas/runtime"
import { boundsOf, type Bounds, type Scene, type Viewport } from "../model/scene"
import type { Held } from "./useBarAnchor"

/** Screen pixels of slack either side of the boundary, so the map card does not flicker on it. */
const TOLERANCE = 8

type Size = { readonly width: number; readonly height: number }

/**
 * Whether part of the map is off screen, given what was answered last. Hides once everything fits
 * with the tolerance to spare, and shows again once anything is past it. An empty map fits. The
 * spare shrinks on a small pane, because fit only leaves 2.5% a side.
 */
export function offScreenAfter(bounds: Bounds | null, viewport: Viewport, pane: Size, was: boolean): boolean {
  if (!bounds || pane.width <= 0 || pane.height <= 0 || viewport.zoom <= 0) {
    return false
  }
  const right = viewport.x + pane.width / viewport.zoom
  const bottom = viewport.y + pane.height / viewport.zoom
  const overflow =
    Math.max(viewport.x - bounds.minX, viewport.y - bounds.minY, bounds.maxX - right, bounds.maxY - bottom) *
    viewport.zoom
  const spare = Math.min(TOLERANCE, 0.02 * Math.min(pane.width, pane.height))
  return was ? overflow > -spare : overflow > TOLERANCE
}

/**
 * The Auto rule, kept current from the camera. `onCamera` belongs in the camera's per-frame callback;
 * the state is only set when it flips, so a pan does not render per frame. Nothing is answered while
 * `held` is set.
 */
export function useMinimapAuto(
  scene: Scene,
  runtime: Held<CanvasRuntime>,
  pane: Held<HTMLElement>,
  held: RefObject<boolean>,
) {
  const [offScreen, setOffScreen] = useState(false)
  const was = useRef(false)
  const bounds = useRef<Bounds | null>(null)

  const onCamera = useCallback((viewport: Viewport, size: Size) => {
    const next = offScreenAfter(bounds.current, viewport, size, was.current)
    if (next !== was.current) {
      was.current = next
      setOffScreen(next)
    }
  }, [])

  // An edit can grow the map past the screen without the camera moving.
  useLayoutEffect(() => {
    bounds.current = scene.elements.length > 0 ? boundsOf(scene.elements) : null
    const viewport = runtime.current?.viewport()
    const host = pane.current
    if (viewport && host && !held.current) {
      onCamera(viewport, { width: host.clientWidth, height: host.clientHeight })
    }
  }, [scene, runtime, pane, held, onCamera])

  return { offScreen, onCamera }
}
