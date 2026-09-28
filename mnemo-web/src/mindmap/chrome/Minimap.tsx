import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react"

import { useT } from "@/i18n/useT"

import type { CanvasRuntime } from "../canvas/runtime"
import { createCssColorResolver } from "../canvas/css-color"
import type { Scene, SceneElement, Viewport } from "../model/scene"
import {
  minimapToWorld,
  paintSelection,
  paintSwatches,
  paintViewport,
  projectMinimap,
  type MinimapProjection,
} from "./minimap-paint"
import type { Held } from "./useBarAnchor"

/** The well inside the map card, in CSS pixels. */
const WIDTH = 204
const HEIGHT = 124

/** Past this many, rings stop picking anything out and cost a stroke each on every camera frame. */
const RING_LIMIT = 200

/** Where the canvas hangs a per-frame camera callback, for the minimap to fill and empty. */
export type MinimapSink = { current: ((viewport: Viewport) => void) | null }

export interface MindmapMinimapProps {
  scene: Scene
  runtime: Held<CanvasRuntime>
  /** The pane the camera fills. Its size is what the viewport rectangle is measured from. */
  pane: Held<HTMLElement>
  /**
   * Called on every camera change; the minimap registers its repaint here. Driven by the event rather
   * than an rAF poll, so the view keeps up even in a tab whose rAF is throttled to a halt.
   */
  sink: MinimapSink
  selected: ReadonlySet<string>
  /** False while the card is tucked away. Nothing is painted then, and the swatches rebuild on return. */
  visible: boolean
  /** Whether the view is being dragged, for the dock to hold the card still until it lets go. */
  onHold?: (held: boolean) => void
}

/**
 * The map card's content: the whole map as swatches, with the camera's view over it.
 *
 * Drawn on a canvas rather than as elements. A map is up to five thousand elements and the well is
 * two hundred pixels wide, so this is five thousand DOM nodes to say almost nothing, on a surface
 * where a single `drawImage` says all of it.
 *
 * Two layers, for the same reason the map itself has two: the swatches move when the document does
 * and the view moves on every frame of a pan. The swatches are drawn once into an offscreen bitmap
 * and only the view is painted over it.
 *
 * One deliberate divergence from the desktop. There, each item was observable per property, so a node
 * being dragged moved its swatch as it went; here the swatches come from the projected scene, which
 * is rebuilt when the drag is committed. On a panel this size a drag is worth a few pixels of swatch,
 * and following it would mean redrawing all five thousand of them per frame.
 */
export function MindmapMinimap({ scene, runtime, pane, sink, selected, visible, onHold }: MindmapMinimapProps) {
  const t = useT()
  const surface = useRef<HTMLCanvasElement>(null)
  const swatches = useRef<HTMLCanvasElement | null>(null)
  const projection = useRef<MinimapProjection | null>(null)
  /** The camera the box was last drawn for, so a swatch rebuild can redraw it without a fresh move. */
  const lastCamera = useRef<Viewport | null>(null)
  const dragging = useRef(false)
  const hovered = useRef(false)
  const byId = useRef(new Map<string, SceneElement>())
  const rings = useRef<SceneElement[]>([])
  const shown = useRef(visible)
  shown.current = visible
  const colors = useMemo(() => createCssColorResolver(), [])
  const theme = useThemeVariant()

  // Draws the layers over each other: the standing swatch bitmap, the selection rings, then the
  // camera's view on top. Reads everything it needs from refs, so it is stable and can be hung on the
  // sink once.
  const composite = useCallback(() => {
    const node = surface.current
    const context = shown.current ? node?.getContext("2d") : null
    if (!node || !context) {
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

    const resolve = (color: string) => colors.resolve(color)
    if (projection.current) {
      paintSelection(context, rings.current, projection.current, resolve)
    }

    const host = pane.current
    if (lastCamera.current && projection.current && host) {
      paintViewport(
        context,
        lastCamera.current,
        { width: host.clientWidth, height: host.clientHeight },
        projection.current,
        { width: WIDTH, height: HEIGHT },
        resolve,
        hovered.current || dragging.current,
      )
    }
  }, [pane, colors])

  // The swatches: rebuilt when the document or the theme changes, then composited once so the panel
  // is never briefly an empty box. Skipped while the card is away; showing it again rebuilds them.
  useLayoutEffect(() => {
    byId.current = new Map(scene.elements.map((element) => [element.id, element]))
    if (!visible) {
      hovered.current = false
      if (dragging.current) {
        dragging.current = false
        onHold?.(false)
      }
      return
    }
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

    // The camera has not moved, but the bitmap under the box is new. Take the runtime's current
    // camera so an edit redraws the box too, and fall back to whatever we were last told.
    lastCamera.current = runtime.current?.viewport() ?? lastCamera.current
    composite()
  }, [scene, theme, colors, composite, runtime, visible, onHold])

  // Selection moves far more often than the document, so it only recomposites.
  useLayoutEffect(() => {
    const picked: SceneElement[] = []
    if (selected.size <= RING_LIMIT) {
      for (const id of selected) {
        const element = byId.current.get(id)
        if (element) {
          picked.push(element)
        }
      }
    }
    rings.current = picked
    composite()
  }, [selected, scene, composite])

  // The canvas drives the box: every camera change lands here and restrokes it over the standing
  // swatches.
  useLayoutEffect(() => {
    const onCamera = (viewport: Viewport) => {
      lastCamera.current = viewport
      composite()
    }
    sink.current = onCamera
    return () => {
      if (sink.current === onCamera) {
        sink.current = null
      }
    }
  }, [sink, composite])

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

  const release = () => {
    if (!dragging.current) {
      return
    }
    dragging.current = false
    onHold?.(false)
    composite()
  }

  const light = (on: boolean) => {
    hovered.current = on
    composite()
  }

  return (
    <canvas
      ref={surface}
      aria-label={t("Mindmap", "Minimap")}
      style={{ width: WIDTH, height: HEIGHT }}
      className="block cursor-grab touch-none active:cursor-grabbing"
      onPointerEnter={() => light(true)}
      onPointerLeave={() => light(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }
        dragging.current = true
        onHold?.(true)
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
        event.currentTarget.releasePointerCapture(event.pointerId)
        release()
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
    />
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
