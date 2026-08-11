/**
 * Edge strokes on a single 2D canvas.
 *
 * The SVG edge layer costs a fixed frame per gesture that has nothing to do with how many edges
 * are on screen: switching edges off entirely moved three scenarios from 30fps to a clean 60,
 * and culling the paths down to the viewport shrank the cost without removing that fixed frame.
 * Chromium's invalidation for an SVG child is far coarser than the child, so the paths are not
 * really what is being paid for. A canvas has no retained children to invalidate: a redraw costs
 * what it draws, which is the property this module exists to price.
 *
 * Labels are NOT drawn here. They stay DOM divs in the existing label layer, because canvas text
 * goes through a different layout and rasterisation path than DOM text and would not match it.
 * Moving the labels too would change what is on screen and leave the two modes incomparable on
 * the one thing being measured.
 */

import type { SceneEdge } from '../model/scene'
import type { Viewport } from '../model/scene'
import { anchorsFor, branchShape, edgeShape, type EdgeStroke, type ElementBox } from './edge-paths'
import { strokeStyleFor, type EdgeStrokeStyle } from './edge-style'

/**
 * Only the parts of a 2D context this renderer touches.
 *
 * Structural rather than `CanvasRenderingContext2D` so the tests can drive it with a recording
 * fake: jsdom ships no 2D context at all, and a renderer that can only be exercised in a real
 * browser is a renderer whose geometry is checked by looking at it.
 */
export interface EdgeCanvasContext {
  /** Widened to the real context's type so a live `CanvasRenderingContext2D` still satisfies it. */
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  setLineDash(segments: number[]): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
}

/** The backing store, which is all the renderer needs of the element itself. */
export interface EdgeCanvasSurface {
  width: number
  height: number
}

export interface EdgeCanvasDeps {
  readonly canvas: EdgeCanvasSurface
  readonly context: EdgeCanvasContext
  readonly edges: readonly SceneEdge[]
  /** Live boxes, so a redraw mid-drag follows the elements rather than the fixture. */
  boxOf(elementId: string): ElementBox | undefined
}

export interface EdgeCanvasRenderer {
  /** CSS size and device pixel ratio. A no-op when nothing changed; see below. */
  resize(width: number, height: number, dpr: number): void
  /**
   * Drops the cached geometry for these edges, because an endpoint moved.
   *
   * Everything else keeps its cache. A pan moves the camera, not the elements, so a whole pan
   * runs without recomputing a single curve; only a drag or a relayout dirties anything.
   */
  invalidate(edgeIds: Iterable<string>): void
  /** Drops every cached curve, for a relayout that moved the whole document. */
  invalidateAll(): void
  /**
   * Strokes exactly these edges, in this camera. Everything else is simply not drawn.
   *
   * Returns how many were actually traced, which is not the same as how many were asked for: an
   * id with no edge behind it, or an edge with a missing endpoint, is skipped. The caller uses it
   * to tell "drew nothing because nothing was visible" apart from "drew nothing because the draw
   * path is broken", and those two look identical in a frame histogram.
   */
  draw(viewport: Viewport, visibleEdgeIds: Iterable<string>): number
  dispose(): void
}

const NO_DASH: number[] = []

/**
 * A curve flattened to plain numbers, cached per edge.
 *
 * Rebuilding geometry every frame was the mistake this replaces, and it was not a small one:
 * canvas mode beat SVG where almost nothing was on screen and lost badly where a lot was, which
 * is the signature of per-frame work proportional to visible edges. A pan does not move any
 * element, so recomputing anchors and control points on every frame of one is pure waste.
 *
 * Numbers rather than the EdgeShape objects because this is read on every frame of every gesture:
 * the object form allocates an anchors record, a stroke record and, for polylines, a point per
 * vertex, all of it garbage within the frame.
 */
interface CachedStroke {
  /**
   * `cubic` is 6 numbers after the initial move; `polyline` is a flat tail of x,y pairs; `ribbon`
   * is 6 for the outbound curve, 2 for the cap across the far end, then 6 for the return.
   */
  readonly kind: 'cubic' | 'polyline' | 'ribbon'
  readonly sx: number
  readonly sy: number
  readonly rest: readonly number[]
}

/**
 * The shape an edge draws as.
 *
 * A hierarchy edge that carries two different end weights is a tapering ribbon; everything else is
 * an ordinary stroke. The widths come from the projector rather than being derived here, so the two
 * substrates and the thumbnail all widen the same edge by the same amount.
 */
function strokeFor(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeStroke {
  const routing = edge.routing ?? 'curve'
  if (edge.fromWidth !== undefined && edge.toWidth !== undefined) {
    return branchShape(routing, anchors, edge.fromWidth, edge.toWidth).stroke
  }
  return edgeShape(routing, anchors).stroke
}

function cacheStroke(stroke: EdgeStroke): CachedStroke {
  if (stroke.kind === 'cubic') {
    return {
      kind: 'cubic',
      sx: stroke.sx,
      sy: stroke.sy,
      rest: [stroke.c1x, stroke.c1y, stroke.c2x, stroke.c2y, stroke.tx, stroke.ty],
    }
  }

  if (stroke.kind === 'ribbon') {
    const [o0, o1, o2, o3] = stroke.outbound
    const [i0, i1, i2, i3] = stroke.inbound
    return {
      kind: 'ribbon',
      sx: o0.x,
      sy: o0.y,
      rest: [o1.x, o1.y, o2.x, o2.y, o3.x, o3.y, i0.x, i0.y, i1.x, i1.y, i2.x, i2.y, i3.x, i3.y],
    }
  }

  const points = stroke.points
  const rest: number[] = []
  for (let i = 1; i < points.length; i++) rest.push(points[i].x, points[i].y)
  return { kind: 'polyline', sx: points[0].x, sy: points[0].y, rest }
}

function traceCached(context: EdgeCanvasContext, cached: CachedStroke): void {
  context.moveTo(cached.sx, cached.sy)
  const rest = cached.rest

  if (cached.kind === 'cubic') {
    context.bezierCurveTo(rest[0], rest[1], rest[2], rest[3], rest[4], rest[5])
    return
  }

  if (cached.kind === 'ribbon') {
    context.bezierCurveTo(rest[0], rest[1], rest[2], rest[3], rest[4], rest[5])
    context.lineTo(rest[6], rest[7])
    context.bezierCurveTo(rest[8], rest[9], rest[10], rest[11], rest[12], rest[13])
    // Closed rather than left open: an unclosed fill would run a straight line back across the
    // ribbon's mouth and paint a wedge over the parent node.
    context.closePath()
    return
  }

  for (let i = 0; i < rest.length; i += 2) context.lineTo(rest[i], rest[i + 1])
}

export function createEdgeCanvasRenderer(deps: EdgeCanvasDeps): EdgeCanvasRenderer {
  const { canvas, context, boxOf } = deps

  const byId = new Map<string, SceneEdge>()
  for (const edge of deps.edges) byId.set(edge.id, edge)

  let cssWidth = 0
  let cssHeight = 0
  let ratio = 1

  /** Geometry cache, keyed by edge id. Survives a pan; dropped when an endpoint moves. */
  const strokes = new Map<string, CachedStroke>()
  /** Style cache, for the same reason: strokeStyleFor allocates a record per call. */
  const styles = new Map<string, EdgeStrokeStyle>()

  return {
    resize(width, height, dpr) {
      // Guarded because assigning to width or height resets the backing store, and the camera
      // path below calls this on every committed viewport. An unguarded resize would clear and
      // reallocate the surface on every frame of a pan.
      if (width === cssWidth && height === cssHeight && dpr === ratio) return
      cssWidth = width
      cssHeight = height
      ratio = dpr
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    },

    invalidate(edgeIds) {
      for (const id of edgeIds) strokes.delete(id)
    },

    invalidateAll() {
      strokes.clear()
    },

    draw(viewport, visibleEdgeIds) {
      // The device-pixel ratio is folded into the camera rather than applied once at resize, the
      // way a static canvas does it. There is no "once" available here: every frame installs a
      // new camera, setTransform replaces the whole matrix, and a separate scale would have to be
      // reapplied on top of it anyway.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)

      const scale = viewport.zoom * ratio
      context.setTransform(scale, 0, 0, scale, -viewport.x * scale, -viewport.y * scale)

      // Drawing in canvas coordinates under that matrix scales line widths and dash lengths with
      // zoom, which is exactly what the SVG mode gets from having its paths inside a scaled
      // group. Transforming the points in JavaScript instead would draw hairlines at 0.1 zoom
      // where the other mode draws none, and the modes would no longer be comparable.
      let applied: EdgeStrokeStyle | null = null
      // A ribbon is filled, so it cannot share a path with stroked edges: one `stroke()` would
      // outline it and one `fill()` would close every open curve in the batch into a lens. The
      // batch therefore carries which operation ends it, and changing operation flushes.
      let open: 'stroke' | 'fill' | null = null
      const flush = (): void => {
        if (open === 'stroke') context.stroke()
        else if (open === 'fill') context.fill()
        open = null
      }

      let drawn = 0
      for (const edgeId of visibleEdgeIds) {
        const edge = byId.get(edgeId)
        if (!edge) continue

        // The endpoint boxes are only read on a cache miss. Reading them unconditionally is what
        // the first version did, and it charged every frame of a pan for two object allocations
        // per visible edge to answer a question whose answer had not changed.
        let cached = strokes.get(edgeId)
        if (cached === undefined) {
          const from = boxOf(edge.fromId)
          const to = boxOf(edge.toId)
          if (!from || !to) continue
          cached = cacheStroke(strokeFor(edge, anchorsFor(from, to)))
          strokes.set(edgeId, cached)
        }
        drawn += 1

        // Edges sharing a style accumulate into one path and one stroke call. Hierarchy edges are
        // the bulk of the document and all share a single style object, so this collapses most of
        // a frame's state changes without changing a pixel: the dash phase restarts per subpath
        // either way.
        let style = styles.get(edgeId)
        if (style === undefined) {
          style = strokeStyleFor(edge)
          styles.set(edgeId, style)
        }
        const wants = cached.kind === 'ribbon' ? 'fill' : 'stroke'
        if (
          applied === null ||
          open !== wants ||
          style.color !== applied.color ||
          style.width !== applied.width ||
          style.dash !== applied.dash
        ) {
          flush()
          if (wants === 'fill') {
            context.fillStyle = style.color
          } else {
            context.strokeStyle = style.color
            context.lineWidth = style.width
            context.setLineDash(style.dash ?? NO_DASH)
          }
          applied = style
        }

        if (open === null) {
          context.beginPath()
          open = wants
        }
        traceCached(context, cached)
      }

      flush()
      return drawn
    },

    dispose() {
      strokes.clear()
      styles.clear()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
    },
  }
}
