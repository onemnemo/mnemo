/**
 * The minimap's geometry, and the two things drawn on it.
 *
 * DOM-free, and driven through a structural context rather than a `CanvasRenderingContext2D`, for the
 * same reason the edge canvas is: jsdom ships no 2D context, so geometry that can only be exercised
 * in a browser is geometry whose only check is somebody looking at it.
 *
 * The two halves are separate because they change at completely different rates. The swatches move
 * when the document does, which is a handful of times a minute; the viewport rectangle moves on every
 * frame of a pan. The component draws the swatches once into a bitmap and re-strokes only the
 * rectangle over it.
 */

import { markColor } from "../scene/branch"
import { boxFromBounds, drawnBoundsOf } from "../scene/element-geometry"
import { boundsOf, type SceneElement, type Point, type Viewport } from "../model/scene"

/** World units of air kept around the content, so the outermost nodes are not against the frame. */
const CONTENT_PADDING = 80

/** A swatch never goes below this, or a large map is a field of invisible sub-pixel marks. */
const MIN_SWATCH = 2

const SWATCH_RADIUS = 1.5
const VIEWPORT_RADIUS = 3
const VIEWPORT_WEIGHT = 1.5
const RING_WEIGHT = 1.25
const RING_GAP = 2
const RING_RADIUS = 3

// The view is called out by fading everything outside it rather than tinting what is inside, so the
// part of the map on screen keeps its own colours. The wash inside only appears while it is handled.
const SURROUND = "var(--canvas)"
const SURROUND_ALPHA = 0.6
const VIEWPORT_WASH = "var(--sel-lasso)"
const ACCENT = "var(--accent)"

/** Only the parts of a 2D context the minimap touches. */
export interface MinimapContext {
  /** Widened to the real context's type so a live `CanvasRenderingContext2D` still satisfies it. */
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  globalAlpha: number
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  rect(x: number, y: number, width: number, height: number): void
  roundRect(x: number, y: number, width: number, height: number, radii: number): void
  clip(): void
  fill(rule?: CanvasFillRule): void
  stroke(): void
}

/** Content to minimap, as `point * scale + offset`. */
export interface MinimapProjection {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

/**
 * How the whole map fits in a box this size, or null when there is nothing to fit.
 *
 * Fits the content rather than the camera, deliberately: the minimap is the answer to "where am I",
 * and a frame that moved with the camera would make every pan look like the map itself had moved.
 */
export function projectMinimap(
  elements: readonly SceneElement[],
  width: number,
  height: number,
): MinimapProjection | null {
  if (elements.length === 0 || width <= 0 || height <= 0) {
    return null
  }

  const bounds = boundsOf(elements)
  const x = bounds.minX - CONTENT_PADDING
  const y = bounds.minY - CONTENT_PADDING
  const contentWidth = bounds.maxX - bounds.minX + CONTENT_PADDING * 2
  const contentHeight = bounds.maxY - bounds.minY + CONTENT_PADDING * 2
  const scale = Math.min(width / contentWidth, height / contentHeight)

  return {
    scale,
    offsetX: (width - contentWidth * scale) / 2 - x * scale,
    offsetY: (height - contentHeight * scale) / 2 - y * scale,
  }
}

/** The inverse: where on the map a press on the minimap landed. */
export function minimapToWorld(point: Point, projection: MinimapProjection): Point {
  return {
    x: (point.x - projection.offsetX) / projection.scale,
    y: (point.y - projection.offsetY) / projection.scale,
  }
}

/** Omits edges because dense branch pixels obscure the map at minimap scale. */
export function paintSwatches(
  context: MinimapContext,
  elements: readonly SceneElement[],
  projection: MinimapProjection,
  resolve: (color: string) => string,
): void {
  for (const element of elements) {
    if (element.line) {
      traceLine(context, element, element.line, projection)
      context.strokeStyle = resolve(markColor(element))
      context.lineWidth = lineWeight(element.line, projection)
      context.stroke()
      continue
    }

    const { x, y, width, height } = swatchRect(element, projection)
    context.beginPath()
    context.roundRect(x, y, width, height, SWATCH_RADIUS)

    // A frame reads as a container: outline only, so the members inside it stay visible. Filled, it
    // would hide the part of the map it is there to group. Its fill is left out of the question for
    // the same reason: a container is coloured by the line around it.
    if (element.kind === "frame") {
      context.strokeStyle = resolve(markColor({ stroke: element.stroke, branchColor: element.branchColor }))
      context.lineWidth = 1
      context.stroke()
      continue
    }

    context.fillStyle = resolve(markColor(element))
    context.fill()
  }
}

/** A line element's path on the minimap, ready to stroke. */
function traceLine(
  context: MinimapContext,
  element: SceneElement,
  line: NonNullable<SceneElement["line"]>,
  projection: MinimapProjection,
): void {
  const point = (value: Point): Point => ({
    x: (element.x + value.x) * projection.scale + projection.offsetX,
    y: (element.y + value.y) * projection.scale + projection.offsetY,
  })
  const start = point(line.start)
  const end = point(line.end)
  context.beginPath()
  context.moveTo(start.x, start.y)
  if (line.bend) {
    const bend = point(line.bend)
    context.quadraticCurveTo(bend.x, bend.y, end.x, end.y)
  } else {
    context.lineTo(end.x, end.y)
  }
}

function lineWeight(line: NonNullable<SceneElement["line"]>, projection: MinimapProjection): number {
  return Math.max(1, line.thickness * projection.scale)
}

/** Where an element's swatch lands on the minimap. */
function swatchRect(element: SceneElement, projection: MinimapProjection) {
  const drawn = boxFromBounds(drawnBoundsOf(element))
  return {
    x: drawn.x * projection.scale + projection.offsetX,
    y: drawn.y * projection.scale + projection.offsetY,
    width: Math.max(MIN_SWATCH, drawn.width * projection.scale),
    height: Math.max(MIN_SWATCH, drawn.height * projection.scale),
  }
}

/**
 * The camera's view: everything outside it faded, then its outline in the accent. `lit` adds a wash
 * inside it, for while the pointer is over the minimap or dragging the view.
 */
export function paintViewport(
  context: MinimapContext,
  viewport: Viewport,
  pane: { readonly width: number; readonly height: number },
  projection: MinimapProjection,
  box: { readonly width: number; readonly height: number },
  resolve: (color: string) => string,
  lit = false,
): void {
  if (pane.width <= 0 || pane.height <= 0 || viewport.zoom <= 0) {
    return
  }

  const x = viewport.x * projection.scale + projection.offsetX
  const y = viewport.y * projection.scale + projection.offsetY
  const width = (pane.width / viewport.zoom) * projection.scale
  const height = (pane.height / viewport.zoom) * projection.scale

  context.save()
  context.beginPath()
  context.rect(0, 0, box.width, box.height)
  context.roundRect(x, y, width, height, VIEWPORT_RADIUS)
  context.fillStyle = resolve(SURROUND)
  context.globalAlpha = SURROUND_ALPHA
  context.fill("evenodd")
  context.globalAlpha = 1

  // Clipped, because the camera can hold more than the map: zoomed far enough out, the rectangle is
  // larger than the panel, and an unclipped stroke would run over the panel's rounded corners.
  const inset = VIEWPORT_WEIGHT / 2
  context.beginPath()
  context.rect(inset, inset, box.width - inset * 2, box.height - inset * 2)
  context.clip()

  context.beginPath()
  context.roundRect(x, y, width, height, VIEWPORT_RADIUS)
  if (lit) {
    context.fillStyle = resolve(VIEWPORT_WASH)
    context.fill()
  }
  context.strokeStyle = resolve(ACCENT)
  context.lineWidth = VIEWPORT_WEIGHT
  context.stroke()
  context.restore()
}

/** A ring just outside each selected element's swatch. Painted under the view, so the fade dims it too. */
export function paintSelection(
  context: MinimapContext,
  selected: readonly SceneElement[],
  projection: MinimapProjection,
  resolve: (color: string) => string,
): void {
  if (selected.length === 0) {
    return
  }
  for (const element of selected) {
    // A line's box is mostly empty space, so it is haloed along its own path instead, then redrawn in
    // its colour on top so the halo reads as an outline.
    if (element.line) {
      const weight = lineWeight(element.line, projection)
      context.save()
      context.lineCap = "round"
      traceLine(context, element, element.line, projection)
      context.strokeStyle = resolve(ACCENT)
      context.lineWidth = weight + RING_WEIGHT * 2
      context.stroke()
      context.strokeStyle = resolve(markColor(element))
      context.lineWidth = weight
      context.stroke()
      context.restore()
      continue
    }
    const { x, y, width, height } = swatchRect(element, projection)
    context.beginPath()
    context.roundRect(x - RING_GAP, y - RING_GAP, width + RING_GAP * 2, height + RING_GAP * 2, RING_RADIUS)
    context.strokeStyle = resolve(ACCENT)
    context.lineWidth = RING_WEIGHT
    context.stroke()
  }
}
