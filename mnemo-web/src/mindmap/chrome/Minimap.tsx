import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react"

import { useT } from "@/i18n/useT"

import type { CanvasRuntime } from "../canvas/runtime"
import { createCssColorResolver } from "../canvas/css-color"
import type { Scene } from "../model/scene"
import {
  minimapToWorld,
  paintSwatches,
  paintViewport,
  projectMinimap,
  type MinimapProjection,
} from "./minimap-paint"
import type { Held } from "./useBarAnchor"

/** The panel's size, in CSS pixels. Matches the desktop's, which is what the padding was tuned for. */
const WIDTH = 150
const HEIGHT = 98

export interface MindmapMinimapProps {
  scene: Scene
  runtime: Held<CanvasRuntime>
  /** The pane the camera fills. Its size is what the viewport rectangle is measured from. */
  pane: Held<HTMLElement>
}

/**
 * The bottom-right minimap: the whole map as swatches, with the camera's own box over it.
 *
 * Drawn on a canvas rather than as elements. A map is up to five thousand elements and the panel is
 * a hundred and fifty pixels wide, so this is five thousand DOM nodes to say almost nothing, on a
 * surface where a single `drawImage` says all of it.
 *
 * Two layers, for the same reason the map itself has two: the swatches move when the document does
 * and the camera box moves on every frame of a pan. The swatches are drawn once into an offscreen
 * bitmap and only the box is re-stroked over it.
 *
 * One deliberate divergence from the desktop. There, each item was observable per property, so a node
 * being dragged moved its swatch as it went; here the swatches come from the projected scene, which
 * is rebuilt when the drag is committed. On a panel this size a drag is worth a few pixels of swatch,
 * and following it would mean redrawing all five thousand of them per frame.
 */
export function MindmapMinimap({ scene, runtime, pane }: MindmapMinimapProps) {
  const t = useT()
  const surface = useRef<HTMLCanvasElement>(null)
  const swatches = useRef<HTMLCanvasElement | null>(null)
  const projection = useRef<MinimapProjection | null>(null)
  /** The camera the last composite was for, so a still map costs one comparison a frame. */
  const painted = useRef("")
  const dragging = useRef(false)
  const colors = useMemo(() => createCssColorResolver(), [])
  const theme = useThemeVariant()

  useLayoutEffect(() => {
    const bitmap = swatches.current ?? document.createElement("canvas")
    swatches.current = bitmap

    const ratio = window.devicePixelRatio || 1
    bitmap.width = Math.round(WIDTH * ratio)
    bitmap.height = Math.round(HEIGHT * ratio)

    projection.current = projectMinimap(scene.elements, WIDTH, HEIGHT)
    const context = bitmap.getContext("2d")
    if (context) {
      // Every swatch colour is a theme variable, and the answers cached here were the old theme's.
      colors.invalidate()
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, WIDTH, HEIGHT)
      if (projection.current) {
        paintSwatches(context, scene.elements, projection.current, (color) => colors.resolve(color))
      }
    }

    // The bitmap under it is new, so the composite has to run again even if the camera has not moved.
    painted.current = ""
  }, [scene, theme, colors])

  useLayoutEffect(() => {
    let frame = 0

    const paint = () => {
      frame = requestAnimationFrame(paint)

      const node = surface.current
      const camera = runtime.current
      const host = pane.current
      if (!node || !camera || !host) {
        return
      }

      const viewport = camera.viewport()
      const size = { width: host.clientWidth, height: host.clientHeight }
      const key = `${viewport.x},${viewport.y},${viewport.zoom},${size.width},${size.height}`
      if (key === painted.current) {
        return
      }
      painted.current = key

      const context = node.getContext("2d")
      if (!context) {
        return
      }

      const ratio = window.devicePixelRatio || 1
      const backing = Math.round(WIDTH * ratio)
      if (node.width !== backing) {
        node.width = backing
        node.height = Math.round(HEIGHT * ratio)
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, WIDTH, HEIGHT)
      if (swatches.current) {
        context.drawImage(swatches.current, 0, 0, WIDTH, HEIGHT)
      }
      if (projection.current) {
        paintViewport(context, viewport, size, projection.current, { width: WIDTH, height: HEIGHT }, (color) =>
          colors.resolve(color),
        )
      }
    }

    // Once before the browser paints, or the panel is briefly an empty box when the map opens.
    paint()
    return () => cancelAnimationFrame(frame)
  }, [pane, runtime, colors])

  const recenter = (event: PointerEvent<HTMLCanvasElement>) => {
    const camera = runtime.current
    const host = pane.current
    const map = projection.current
    if (!camera || !host || !map) {
      return
    }

    const box = event.currentTarget.getBoundingClientRect()
    const at = minimapToWorld({ x: event.clientX - box.left, y: event.clientY - box.top }, map)
    const { zoom } = camera.viewport()
    camera.setViewport({
      zoom,
      x: at.x - host.clientWidth / (2 * zoom),
      y: at.y - host.clientHeight / (2 * zoom),
    })
  }

  return (
    // Sunken rather than the canvas colour: most nodes are surface-filled, and a white swatch on
    // white paper would leave the panel showing only the coloured half of the map.
    <div className="pointer-events-auto absolute bottom-4 right-4 z-40 overflow-hidden rounded-[10px] bg-canvas-sunken shadow-pop animate-pop-in">
      <canvas
        ref={surface}
        aria-label={t("Mindmap", "Minimap")}
        style={{ width: WIDTH, height: HEIGHT }}
        className="block cursor-pointer touch-none"
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return
          }
          dragging.current = true
          // The press lands first: capture is for the drag that may follow, and a refused capture
          // should not cost the click.
          recenter(event)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (dragging.current) {
            recenter(event)
          }
        }}
        onPointerUp={(event) => {
          dragging.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      />
    </div>
  )
}

/** The theme in force, so the swatches can be repainted in it. Their colours are variables. */
function useThemeVariant(): string | null {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme"))

  useEffect(() => {
    const watcher = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute("data-theme")),
    )
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => watcher.disconnect()
  }, [])

  return theme
}
