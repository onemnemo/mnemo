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
import { boundsOf, type SceneElement, type Point, type Viewport } from "../model/scene"

/** World units of air kept around the content, so the outermost nodes are not against the frame. */
const CONTENT_PADDING = 80

/** A swatch never goes below this, or a large map is a field of invisible sub-pixel marks. */
const MIN_SWATCH = 2

const SWATCH_RADIUS = 1.5
const VIEWPORT_RADIUS = 2
const VIEWPORT_WEIGHT = 1.5

// The viewport box is the same idea as a marquee, a region called out over the map, so it borrows the
// lasso's own colours: a translucent accent wash inside, a stronger accent line around it. The old
// muted-ink hairline was there but almost impossible to see against the swatches.
const VIEWPORT_FILL = "var(--sel-lasso)"
const VIEWPORT_STROKE = "var(--sel-lasso-line)"

/** Only the parts of a 2D context the minimap touches. */
export interface MinimapContext {
  /** Widened to the real context's type so a live `CanvasRenderingContext2D` still satisfies it. */
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, width: number, height: number): void
  roundRect(x: number, y: number, width: number, height: number, radii: number): void
  clip(): void
  fill(): void
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

/**
 * Every element as a swatch in its own colour.
 *
 * Elements only, not edges. At this size a branch is a hair thinner than a pixel, and drawing five
 * thousand of them would trade the one thing the minimap is for, the shape of the map, for a grey haze.
 */
export function paintSwatches(
  context: MinimapContext,
  elements: readonly SceneElement[],
  projection: MinimapProjection,
  resolve: (color: string) => string,
): void {
  for (const element of elements) {
    const x = element.x * projection.scale + projection.offsetX
    const y = element.y * projection.scale + projection.offsetY
    const width = Math.max(MIN_SWATCH, element.width * projection.scale)
    const height = Math.max(MIN_SWATCH, element.height * projection.scale)

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

/** The camera's own box, over the swatches. */
export function paintViewport(
  context: MinimapContext,
  viewport: Viewport,
  pane: { readonly width: number; readonly height: number },
  projection: MinimapProjection,
  box: { readonly width: number; readonly height: number },
  resolve: (color: string) => string,
): void {
  if (pane.width <= 0 || pane.height <= 0 || viewport.zoom <= 0) {
    return
  }

  context.save()
  // Clipped, because the camera can hold more than the map: zoomed far enough out, the rectangle is
  // larger than the panel, and an unclipped stroke would run over the panel's rounded corners.
  const inset = VIEWPORT_WEIGHT / 2
  context.beginPath()
  context.rect(inset, inset, box.width - inset * 2, box.height - inset * 2)
  context.clip()

  context.beginPath()
  context.roundRect(
    viewport.x * projection.scale + projection.offsetX,
    viewport.y * projection.scale + projection.offsetY,
    (pane.width / viewport.zoom) * projection.scale,
    (pane.height / viewport.zoom) * projection.scale,
    VIEWPORT_RADIUS,
  )
  // Fill then stroke the one path: the wash says which part of the map the camera holds, the line
  // draws its edge.
  context.fillStyle = resolve(VIEWPORT_FILL)
  context.fill()
  context.strokeStyle = resolve(VIEWPORT_STROKE)
  context.lineWidth = VIEWPORT_WEIGHT
  context.stroke()
  context.restore()
}
