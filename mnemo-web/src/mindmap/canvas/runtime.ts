/**
 * Everything the canvas does that React must not be in the way of.
 *
 * The camera, the culler, the level-of-detail bands and the edge substrate all change on pointer
 * events at up to a hundred and twenty a second, and none of them change what the scene *is*. Routing
 * them through React state would cost a render per frame of every pan, on a component tree the size
 * of the visible document. So they live here, behind a plain object with a mount and a dispose, and
 * React's only job is to put the DOM on screen once per scene.
 *
 * The measured substrate this drives is frozen: refcounted culling over a uniform grid, three
 * level-of-detail bands, and a hybrid edge substrate that swaps SVG for canvas at overview zoom. This
 * module wires those together and adds nothing to the frame.
 */

import { panBy, svgCameraTransform, worldTransform, zoomAt } from "./camera"
import { createCssColorResolver } from "./css-color"
import { createCuller } from "./culler"
import { createEdgeCanvasRenderer, type EdgeCanvasRenderer } from "./edge-canvas"
import { createEdgeStrategySelector, type EdgeStrategy } from "./edge-strategy"
import type { EdgeMode } from "./edge-style"
import { LodController } from "./lod"
import { createSceneIndex, type SceneIndex } from "./scene-index"
import { boundsOf, fitZoom, type Scene, type Viewport } from "../model/scene"

/** The two swappable layers, whichever of them is currently mounted. */
export interface EdgeElements {
  /** The inner group of the viewport-sized edge SVG, which carries the camera separately. */
  readonly edgeCamera: SVGGElement | null
  readonly edgeCanvas: HTMLCanvasElement | null
}

export interface CanvasElements extends EdgeElements {
  /** The clipping viewport. Sized by the layout; everything else is measured against it. */
  readonly pane: HTMLElement
  /** Carries the camera transform; holds the element hosts and the edge labels. */
  readonly world: HTMLElement
  /** Gets the background's own pattern offset, so a dot grid pans with the map. */
  readonly background: HTMLElement | null
}

export interface CanvasRuntimeOptions {
  readonly scene: Scene
  readonly elements: CanvasElements
  readonly strategy?: EdgeStrategy
  /** The substrate to start on, which the caller had to know to render the right layer. */
  readonly edgeMode: EdgeMode
  /**
   * The zoom crossed a substrate threshold. The caller mounts the other layer and calls
   * `rebindEdges`; nothing is drawn on the new substrate until it does.
   */
  readonly onEdgeMode?: (next: EdgeMode) => void
  /** Told after the camera settles, for a zoom readout. Never per frame. */
  readonly onCameraSettled?: (viewport: Viewport) => void
}

export interface CanvasRuntime {
  viewport(): Viewport
  setViewport(next: Viewport): void
  /** Frames the whole map, or leaves it alone when there is nothing to frame. */
  fit(): void
  zoomBy(factor: number): void
  /** Hands over the newly mounted edge layer after a substrate swap. */
  rebindEdges(next: EdgeElements): void
  index(): SceneIndex
  dispose(): void
}

/** Wide enough that a background pattern still covers after a pan without being redrawn. */
const BACKGROUND_TILE = 24

export function createCanvasRuntime(options: CanvasRuntimeOptions): CanvasRuntime {
  const { scene, elements } = options
  const strategy: EdgeStrategy = options.strategy ?? "hybrid"

  let viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  let mode: EdgeMode = options.edgeMode
  let edgeCamera = elements.edgeCamera
  let edgeCanvas = elements.edgeCanvas

  const index = createSceneIndex(scene, elements.pane, mode)
  const culler = createCuller(index.cullTargets(), true)
  const lod = new LodController(elements.world)
  const selector = createEdgeStrategySelector(strategy, viewport.zoom)

  const colors = createCssColorResolver()
  let edgeRenderer: EdgeCanvasRenderer | null = null

  const openCanvas = (): void => {
    if (!edgeCanvas || edgeRenderer) {
      return
    }
    edgeRenderer = createEdgeCanvasRenderer({
      canvas: edgeCanvas,
      context: canvasContext(edgeCanvas),
      edges: scene.edges,
      boxOf: (id) => index.boxOf(id),
      resolveColor: (color) => colors.resolve(color),
    })
    edgeRenderer.resize(elements.pane.clientWidth, elements.pane.clientHeight, window.devicePixelRatio || 1)
  }

  const closeCanvas = (): void => {
    edgeRenderer?.dispose()
    edgeRenderer = null
  }

  let settleTimer = 0
  /** A fit was asked for before the pane had a size; the next resize honours it. */
  let pendingFit = false

  const applyCamera = (): void => {
    elements.world.style.transform = worldTransform(viewport)
    if (edgeCamera) {
      edgeCamera.setAttribute("transform", svgCameraTransform(viewport))
    }
    if (elements.background) {
      // The pattern is a background-image, so it pans by offset and zooms by size. Cheaper than a
      // transform on a viewport-sized element, and it never blurs the way a scaled bitmap would.
      const step = BACKGROUND_TILE * viewport.zoom
      elements.background.style.backgroundSize = `${step}px ${step}px`
      elements.background.style.backgroundPosition = `${-viewport.x * viewport.zoom}px ${-viewport.y * viewport.zoom}px`
    }

    culler.update(viewport, elements.pane.clientWidth, elements.pane.clientHeight)
    lod.apply(viewport.zoom)

    const swapped = selector.update(viewport.zoom)
    if (swapped && swapped !== mode) {
      // The layer being left is torn down here and the one being entered is mounted by the caller,
      // because both substrates' measured failures are caused by the layer merely existing: a
      // viewport SVG cost a frame per pan with every path inside it hidden, and the canvas collapses
      // at overview zoom while drawing nothing. A hidden layer would still carry that.
      mode = swapped
      if (mode !== "canvas") {
        closeCanvas()
      }
      edgeCamera = null
      edgeCanvas = null
      options.onEdgeMode?.(mode)
      return
    }

    if (mode === "canvas" && edgeRenderer) {
      edgeRenderer.draw(viewport, culler.renderedEdgeIds())
    }

    if (options.onCameraSettled) {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => options.onCameraSettled?.(viewport), 120)
    }
  }

  const fit = (): void => {
    const width = elements.pane.clientWidth
    const height = elements.pane.clientHeight
    // A pane with no size yet cannot be framed against: dividing by zero drives the zoom straight to
    // the floor and parks the map somewhere off screen. This is the ordinary first frame, not an edge
    // case, because a stylesheet that has not landed leaves the pane at nothing.
    if (width === 0 || height === 0 || scene.elements.length === 0) {
      pendingFit = true
      return
    }

    pendingFit = false
    const bounds = boundsOf(scene.elements)
    const { zoom } = fitZoom(bounds, width, height)
    viewport = {
      zoom,
      x: (bounds.minX + bounds.maxX) / 2 - width / (2 * zoom),
      y: (bounds.minY + bounds.maxY) / 2 - height / (2 * zoom),
    }
    applyCamera()
  }

  const resize = (): void => {
    if (edgeRenderer) {
      edgeRenderer.resize(
        elements.pane.clientWidth,
        elements.pane.clientHeight,
        window.devicePixelRatio || 1,
      )
    }
    if (pendingFit) {
      fit()
      return
    }
    applyCamera()
  }

  /* ---- gestures ---- */

  let panning = false
  let panPointer = -1

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const rect = elements.pane.getBoundingClientRect()
    viewport = zoomAt(viewport, event.deltaY, event.clientX - rect.left, event.clientY - rect.top)
    applyCamera()
  }

  const onPointerDown = (event: PointerEvent): void => {
    // Middle button, or a space-held left drag, pans from anywhere. A plain left press on empty
    // canvas is a marquee, which belongs to the selection layer and not here.
    const wantsPan = event.button === 1 || (event.button === 0 && event.altKey)
    if (!wantsPan) {
      return
    }
    panning = true
    panPointer = event.pointerId
    elements.pane.setPointerCapture(event.pointerId)
    elements.pane.style.cursor = "grabbing"
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!panning || event.pointerId !== panPointer) {
      return
    }
    viewport = panBy(viewport, event.movementX, event.movementY)
    applyCamera()
  }

  const endPan = (event: PointerEvent): void => {
    if (!panning || event.pointerId !== panPointer) {
      return
    }
    panning = false
    panPointer = -1
    elements.pane.releasePointerCapture(event.pointerId)
    elements.pane.style.cursor = ""
  }

  elements.pane.addEventListener("wheel", onWheel, { passive: false })
  elements.pane.addEventListener("pointerdown", onPointerDown)
  elements.pane.addEventListener("pointermove", onPointerMove)
  elements.pane.addEventListener("pointerup", endPan)
  elements.pane.addEventListener("pointercancel", endPan)

  const observer = new ResizeObserver(resize)
  observer.observe(elements.pane)

  // The SVG layer repaints itself on a theme change, because its colours are still variables. The
  // canvas holds literals it resolved once, so it has to be told, and told before it is asked to
  // draw again or a dark map would keep drawing in the light theme's branch colours.
  const themeWatcher = new MutationObserver(() => {
    colors.invalidate()
    edgeRenderer?.invalidateStyles()
    applyCamera()
  })
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })

  if (mode === "canvas") {
    openCanvas()
  }
  resize()

  return {
    viewport: () => viewport,

    setViewport(next) {
      viewport = next
      applyCamera()
    },

    fit,

    zoomBy(factor) {
      // Through the same anchored arithmetic the wheel uses, about the pane's centre, so a button
      // press and a wheel notch cannot drift apart.
      const width = elements.pane.clientWidth / 2
      const height = elements.pane.clientHeight / 2
      viewport = zoomAt(viewport, -Math.log(factor) / 0.002, width, height)
      applyCamera()
    },

    rebindEdges(next) {
      edgeCamera = next.edgeCamera
      edgeCanvas = next.edgeCanvas
      if (mode === "canvas") {
        openCanvas()
      }
      // The index reads the DOM of whichever layer is up, and the culler's grid holds references to
      // the elements that layer owns, so both are stale the moment the layer is replaced.
      index.rebindEdgeDom(mode)
      culler.rebuild()
      applyCamera()
    },

    index: () => index,

    dispose() {
      window.clearTimeout(settleTimer)
      observer.disconnect()
      themeWatcher.disconnect()
      elements.pane.removeEventListener("wheel", onWheel)
      elements.pane.removeEventListener("pointerdown", onPointerDown)
      elements.pane.removeEventListener("pointermove", onPointerMove)
      elements.pane.removeEventListener("pointerup", endPan)
      elements.pane.removeEventListener("pointercancel", endPan)
      closeCanvas()
    },
  }
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("The mindmap edge canvas has no 2D context.")
  }
  return context
}
