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
import { MotionHint } from "./motion"
import { createSceneIndex, edgeCullKey, nodeCullKey, type SceneIndex } from "./scene-index"
import { boundsOf, fitZoom, type Point, type Scene, type Viewport } from "../model/scene"

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
  /**
   * The selection highlight's camera group, held as a box rather than as a value because the layer
   * is mounted only while something is selected and the runtime outlives every selection.
   */
  readonly overlayCamera?: { current: SVGGElement | null }
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
  /**
   * Told on every camera change, as it happens. The minimap's box tracks this, so it cannot be an
   * rAF poll that a throttled tab would freeze. Not fired for an element move that leaves the camera
   * where it was; the debounced `onCameraSettled` is the one a resting readout wants instead.
   */
  readonly onCameraChange?: (viewport: Viewport) => void
  /** Told after the camera settles, for a zoom readout. Never per frame. */
  readonly onCameraSettled?: (viewport: Viewport) => void
  /**
   * A `fit()` hit the camera's floor and is showing the map smaller than a whole-map fit would need,
   * which only happens on a map large enough that framing all of it is not actually possible. Silent
   * otherwise; most maps fit with room to spare and this never fires for them.
   */
  readonly onFitClamped?: () => void
}

export interface CanvasRuntime {
  viewport(): Viewport
  setViewport(next: Viewport): void
  /** Frames the whole map, or leaves it alone when there is nothing to frame. */
  fit(): void
  zoomBy(factor: number): void
  /** Hands over the newly mounted edge layer after a substrate swap. */
  rebindEdges(next: EdgeElements): void
  /** A client point in canvas coordinates. What a gesture needs to know where it is. */
  toCanvas(clientX: number, clientY: number): Point
  /** The inverse: a canvas point in pixels from the pane's top-left. */
  toPane(point: Point): Point
  /**
   * Redraws what the substrate owns, for a caller that moved elements under it. The camera has not
   * changed, but the culler's bounds and the canvas edge layer are both read from positions.
   *
   * The edges whose endpoints moved have to be named. The canvas substrate caches each edge as a
   * flattened curve and keeps that cache across a whole pan, which is most of why a pan costs
   * nothing; an endpoint moving is the one thing the cache cannot see for itself. A redraw that
   * does not say so repaints the curve the edge used to have, and the edges only catch up when the
   * next projection rebuilds everything, which is to say when the drag is let go of.
   */
  redraw(movedEdgeIds?: readonly string[]): void
  /**
   * Holds these elements and edges rendered for the length of a gesture.
   *
   * The culler indexes its grid from where things were, and a drag moves them without reindexing.
   * That costs nothing while the camera is still, since a cell range that has not moved does no
   * work at all, but a wheel notch during a drag consults that stale grid and can hide the very
   * node being dragged.
   */
  pin(elementIds: readonly string[], edgeIds: readonly string[]): void
  unpin(): void
  index(): SceneIndex
  /**
   * Aborts whatever pointer gesture the interaction layer has active, reverting positions and sizes
   * to where the gesture began. Wired in by the caller, which owns the interaction controller this
   * runtime does not know about; a no-op until then. What lets a keyboard Escape cancel a drag,
   * resize, marquee, or connect line a pointer started.
   */
  cancelGesture(): void
  dispose(): void
}

/** Wide enough that a background pattern still covers after a pan without being redrawn. */
const BACKGROUND_TILE = 24

/**
 * The smallest the tile is ever allowed to get on screen.
 *
 * Below roughly this the grid stops reading as ground and starts fighting the map: the lines crowd,
 * then merge into a flat wash of line colour, then beat against the pixel grid as moire. At the
 * camera floor a fixed tile would land at half a pixel, which is all three at once.
 */
const MIN_BACKGROUND_STEP = 18

/**
 * The tile's size on screen, coarsened by whole doublings until it clears the minimum.
 *
 * Doublings rather than an arbitrary factor because every coarser tile has to stay a multiple of the
 * one below it. A grid that rescaled continuously would slide its lines off the world positions they
 * marked at the previous zoom, and zooming out would look like the map drifting over its own paper.
 */
export function backgroundStep(zoom: number): number {
  const step = BACKGROUND_TILE * zoom
  if (!(step > 0)) {
    return BACKGROUND_TILE
  }

  // Only ever coarsen. Subdividing when zoomed in would draw lines at world positions the document
  // has no notion of, and the tile is already comfortable at the ceiling.
  const doublings = Math.max(0, Math.ceil(Math.log2(MIN_BACKGROUND_STEP / step)))
  return step * 2 ** doublings
}

/** A value folded into `[0, size)`, for an offset that only means anything modulo the tile. */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}

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
  const motion = new MotionHint(elements.world)
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

  const applyCamera = (notify = true): void => {
    // Ahead of the transform write, so the frame that moves the map is already composited. Every
    // path into here is something moving: the camera, or a drag asking for a redraw.
    motion.moved()
    elements.world.style.transform = worldTransform(viewport)
    // Chrome drawn inside an element, which is scaled with everything else, has to be told what to
    // undo. Only the selection carries any, so this costs a property write per selected element.
    index.writeZoom(viewport.zoom)
    if (edgeCamera) {
      edgeCamera.setAttribute("transform", svgCameraTransform(viewport))
    }
    if (elements.overlayCamera?.current) {
      elements.overlayCamera.current.setAttribute("transform", svgCameraTransform(viewport))
    }
    if (elements.background) {
      // The pattern is a background-image, so it pans by offset and zooms by size. Cheaper than a
      // transform on a viewport-sized element, and it never blurs the way a scaled bitmap would.
      const step = backgroundStep(viewport.zoom)
      elements.background.style.backgroundSize = `${step}px ${step}px`
      // Wrapped into one tile rather than handed over whole. CSS would take the raw offset and
      // wrap it itself, but a map panned far from the origin at high zoom hands it a number large
      // enough that the fractional part is gone, and the grid jitters against the elements on it.
      elements.background.style.backgroundPosition = `${wrap(-viewport.x * viewport.zoom, step)}px ${wrap(-viewport.y * viewport.zoom, step)}px`
    }

    // Ahead of the swap's early return below, so the minimap hears about the move even on the frame a
    // substrate crossing happens.
    if (notify) {
      options.onCameraChange?.(viewport)
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

    if (notify && options.onCameraSettled) {
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
    const { zoom, clampedToFloor } = fitZoom(bounds, width, height)
    viewport = {
      zoom,
      x: (bounds.minX + bounds.maxX) / 2 - width / (2 * zoom),
      y: (bounds.minY + bounds.maxY) / 2 - height / (2 * zoom),
    }
    applyCamera()
    if (clampedToFloor) {
      options.onFitClamped?.()
    }
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
    if (event.ctrlKey) {
      // A trackpad's pinch gesture is delivered as a wheel event with ctrlKey synthesized true,
      // which is also the platform convention for "this wheel means zoom" on a real ctrl-held wheel.
      const rect = elements.pane.getBoundingClientRect()
      viewport = zoomAt(viewport, event.deltaY, event.clientX - rect.left, event.clientY - rect.top)
    } else {
      // Plain wheel pans, the way two-finger trackpad scroll and every other canvas surface reads
      // it. Negated because panBy is calibrated for a hand dragging the surface, where moving the
      // hand down reveals what is above; a wheel scrolling down should reveal what is below instead.
      viewport = panBy(viewport, -event.deltaX, -event.deltaY)
    }
    applyCamera()
  }

  const onPointerDown = (event: PointerEvent): void => {
    // Middle button, or an alt-held left drag, pans from anywhere. A plain left press on empty
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

    toCanvas(clientX, clientY) {
      const rect = elements.pane.getBoundingClientRect()
      return {
        x: viewport.x + (clientX - rect.left) / viewport.zoom,
        y: viewport.y + (clientY - rect.top) / viewport.zoom,
      }
    },

    toPane: (point) => ({
      x: (point.x - viewport.x) * viewport.zoom,
      y: (point.y - viewport.y) * viewport.zoom,
    }),

    redraw(movedEdgeIds) {
      if (movedEdgeIds && movedEdgeIds.length > 0) {
        edgeRenderer?.invalidate(movedEdgeIds)
      }
      applyCamera(false)
    },

    pin(elementIds, edgeIds) {
      const keys = elementIds.map(nodeCullKey)
      for (const id of edgeIds) {
        keys.push(edgeCullKey(id))
      }
      culler.pin(keys)
    },

    unpin: () => culler.unpinAll(),

    // Overwritten by the caller once the interaction controller is installed, which knows what
    // gesture, if any, is active. This runtime has no notion of gestures at all.
    cancelGesture: () => {},

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
      motion.dispose()
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
