/**
 * The bridge between element ids and the DOM the scene rendered, plus the only two write paths
 * the arm has: move some elements, and repaint the edges that touch them.
 *
 * This module is where A2's performance claim is either true or false, so the shape of it is
 * the argument. Every entry point is proportional to the number of elements the CALLER named,
 * never to the size of the document. A pan touches none of it. A single-node drag touches one
 * node and its incident edges. A frame drag touches its members. Nothing here ever walks the
 * five thousand.
 *
 * Positions live here rather than in React state for the same reason: a position that lives in
 * a component is a position that costs a render to change.
 */

import type { ShapeContent, ShapeType } from '../model/document'
import type { SceneEdge, Scene, SceneElement, SceneLine } from '../model/scene'
import type { Point } from '../model/scene'
import { boxFromBounds, drawnBoundsOf, lineLabelPoint } from '../scene/element-geometry'
import {
  absoluteLine,
  extentOf,
  isAttachmentTarget,
  lineBox,
  linePath,
  midpoint,
  relative,
  resolveLine,
  type AbsoluteLine,
  type AnchorTarget,
} from '../scene/line-geometry'
import type { CullableNode, CullBounds, CullTarget } from './culler'
import { strokeFor } from './edge-canvas'
import { anchorsFor, edgeShape, strokeToPathData, type ElementBox } from './edge-paths'
import type { EdgeMode } from './edge-style'
import { bendRingLook } from './line-marks'
import { shapePath } from './shape-path'

/**
 * Cull keys are namespaced because elements and edges share one grid. One grid rather than two
 * keeps a single cell-range comparison per frame, which is the check that makes most frames of
 * a pan cost nothing at all.
 */
export function nodeCullKey(elementId: string): string {
  return `n:${elementId}`
}

const EDGE_KEY_PREFIX = 'e:'

export function edgeCullKey(edgeId: string): string {
  return `${EDGE_KEY_PREFIX}${edgeId}`
}

/**
 * The edge id behind a cull key, or null for an element's.
 *
 * The canvas mode reads its visible set out of the culler's rendered keys, so it needs the
 * inverse of the namespacing above. Kept next to the key builder so the two cannot drift.
 */
export function edgeIdFromCullKey(key: string): string | null {
  return key.startsWith(EDGE_KEY_PREFIX) ? key.slice(EDGE_KEY_PREFIX.length) : null
}

interface LineDom {
  readonly stroke: Element | null
  readonly hit: Element | null
  readonly select: Element | null
  readonly rings: Readonly<Record<'start' | 'end' | 'bend', SVGGElement | null>>
  readonly tangents: Readonly<Record<'start' | 'end', SVGLineElement | null>>
  readonly label: HTMLElement | null
}

export interface SceneIndex {
  positionOf(id: string): Point | undefined
  /** The live box of an element, which is what an edge is drawn between. */
  boxOf(id: string): ElementBox | undefined
  /** The visible axis aligned bounds, including rotation, resolved line ends, and a line caption. */
  drawnBoxOf(id: string): ElementBox | undefined
  hostFor(id: string): HTMLElement | null
  /** The label span an inline edit would type into, if this element renders one. */
  labelFor(id: string): HTMLElement | null
  /** Writes new positions for exactly these ids. Does not touch edges. */
  writePositions(ids: readonly string[], at: (id: string) => Point | undefined): void
  /**
   * A new box for one element, position and size together.
   *
   * Size as well as position because a resize has to reach three things at once: the host, so the
   * box on screen follows the pointer; the size this index reports, so an edge meeting the element
   * lands on its new border rather than its old one; and a shape's outline, which is a path drawn
   * to the box and so would otherwise keep the size React last rendered it at.
   */
  writeBox(id: string, box: ElementBox): void
  /** Updates the inherited screen-space scale when camera zoom changes. */
  writeZoom(zoom: number): void
  /** Edge ids with an endpoint among these elements. Computed once per gesture, not per frame. */
  incidentEdges(ids: readonly string[]): readonly string[]
  linesToRepaint(ids: readonly string[]): readonly string[]
  repaintLines(lineIds: readonly string[]): void
  lineOf(id: string): SceneLine | undefined
  rotationOf(id: string): number
  writeLine(id: string, line: AbsoluteLine): void
  writeRotation(id: string, degrees: number): void
  anchorTargets(): readonly AnchorTarget[]
  /**
   * Rewrites whatever DOM these edges own: the path in svg mode, the label in either mode that
   * draws edges. In canvas mode the strokes are not DOM and are not this function's business.
   */
  repaintEdges(edgeIds: readonly string[]): void
  /**
   * Re-reads the edge DOM after a hybrid run swapped substrates.
   *
   * In place, keeping this object's identity, because the gesture installer was handed the index
   * itself at mount. The caller still has to rebuild the culler afterwards: its targets captured
   * the old path elements, and those are no longer in the document.
   */
  rebindEdgeDom(substrate: EdgeMode): void
  allEdgeIds(): readonly string[]
  setSelected(ids: readonly string[]): void
  /**
   * Everything the culler can hide, elements and edges alike, with live bounds.
   *
   * Edges are culled for the same reason elements are, and the measurement that forced it is
   * sharper than the one for elements: rewriting a single path's geometry inside a
   * four-thousand-path SVG cost a whole extra frame on every drag, while panning past those
   * same paths without touching them cost nothing. The engine's invalidation for an SVG child
   * is far coarser than the child, so the fix is to have far fewer children rendered.
   *
   * In canvas mode an edge target owns no path, and usually no node at all. It is still
   * registered, because the culler's grid is also how the canvas mode learns which edges are in
   * view; a target with no nodes simply has nothing for the culler to hide, and the edge is
   * culled by not being drawn.
   */
  cullTargets(): readonly CullTarget[]
}

/**
 * Indexed from the pane rather than from the world, because the edge SVG is a sibling of the
 * world rather than a child of it: it is viewport-sized and carries the camera on an inner
 * group, which is what keeps a pan from paying for a canvas-sized box.
 */
export function createSceneIndex(
  scene: Scene,
  pane: HTMLElement,
  edgeMode: EdgeMode,
  zoomRoot: HTMLElement = pane,
): SceneIndex {
  const hosts = new Map<string, HTMLElement>()
  for (const host of pane.querySelectorAll<HTMLElement>('.mm-node')) {
    const id = host.dataset.mmId
    if (id) hosts.set(id, host)
  }
  const elementsById = new Map(scene.elements.map((element) => [element.id, element] as const))

  const paths = new Map<string, SVGPathElement>()
  const labels = new Map<string, HTMLElement>()
  // Mutable because a hybrid run changes it mid-flight, and `cullTargets` reads it.
  let mode = edgeMode

  const readEdgeDom = (): void => {
    paths.clear()
    labels.clear()
    if (mode === 'svg') {
      for (const path of pane.querySelectorAll<SVGPathElement>('path[data-mm-edge]')) {
        const id = path.dataset.mmEdge
        if (id) paths.set(id, path)
      }
    }
    if (mode !== 'off') {
      for (const label of pane.querySelectorAll<HTMLElement>('[data-mm-edge-label]')) {
        const id = label.dataset.mmEdgeLabel
        if (id) labels.set(id, label)
      }
    }
  }

  readEdgeDom()

  const positions = new Map<string, Point>()
  const sizes = new Map<
    string,
    { readonly width: number; readonly height: number; readonly underline?: number }
  >()
  for (const element of scene.elements) {
    positions.set(element.id, { x: element.x, y: element.y })
    // The underline travels with the size because it is where an edge meets this element, and an
    // index that drops it hands the geometry a box with no rule on it and the branch lands short.
    sizes.set(element.id, {
      width: element.width,
      height: element.height,
      underline: element.underline,
    })
  }

  const lines = new Map<string, SceneLine>()
  const attachedTo = new Map<string, string[]>()
  const lineMoves = new Map<string, Point>()
  const rotations = new Map<string, number>()
  for (const element of scene.elements) {
    if (element.line) {
      lines.set(element.id, element.line)
      lineMoves.set(element.id, { x: 0, y: 0 })
      for (const end of [element.line.startAt, element.line.endAt]) {
        if (!end) continue
        const list = attachedTo.get(end.elementId)
        if (list) list.push(element.id)
        else attachedTo.set(end.elementId, [element.id])
      }
    }
    if (element.rotation) rotations.set(element.id, element.rotation)
  }

  const edgesById = new Map<string, SceneEdge>()
  const incident = new Map<string, string[]>()
  const attach = (elementId: string, edgeId: string): void => {
    const list = incident.get(elementId)
    if (list) list.push(edgeId)
    else incident.set(elementId, [edgeId])
  }
  for (const edge of scene.edges) {
    edgesById.set(edge.id, edge)
    attach(edge.fromId, edge.id)
    attach(edge.toId, edge.id)
  }

  const boxOf = (id: string): ElementBox | undefined => {
    const position = positions.get(id)
    const size = sizes.get(id)
    if (!position || !size) return undefined
    const rotation = rotations.get(id)
    const line = lines.get(id)
    return {
      x: position.x,
      y: position.y,
      ...size,
      ...(rotation === undefined ? null : { rotation }),
      ...(line === undefined ? null : { line }),
    }
  }

  const liveElement = (id: string): SceneElement | undefined => {
    const element = elementsById.get(id)
    const position = positions.get(id)
    const size = sizes.get(id)
    if (!element || !position || !size) return undefined
    return {
      ...element,
      ...position,
      width: size.width,
      height: size.height,
      rotation: rotations.get(id),
      line: lines.get(id),
    }
  }

  const drawnBoxOf = (id: string): ElementBox | undefined => {
    const element = liveElement(id)
    return element ? boxFromBounds(drawnBoundsOf(element)) : undefined
  }

  let selected: readonly string[] = []
  let cameraZoom = 1

  const targetOf = (id: string): AnchorTarget | undefined => {
    const box = boxOf(id)
    if (!box || !isAttachmentTarget(elementsById.get(id))) return undefined
    return { id, box, rotation: rotations.get(id) }
  }

  const contentOf = new Map<string, ShapeContent>()
  for (const element of scene.elements) {
    if (element.line) contentOf.set(element.id, element.content as ShapeContent)
  }

  zoomRoot.style.setProperty('--mm-zoom', '1')

  const lineDom = new Map<string, LineDom>()
  const domOf = (id: string): LineDom | undefined => {
    const cached = lineDom.get(id)
    if (cached) return cached
    const host = hosts.get(id)
    if (!host) return undefined
    const dom: LineDom = {
      stroke: host.querySelector('[data-mm-line-stroke]'),
      hit: host.querySelector('[data-mm-line-hit]'),
      select: host.querySelector('[data-mm-line-select]'),
      rings: {
        start: host.querySelector<SVGGElement>('[data-mm-handle="start"]'),
        end: host.querySelector<SVGGElement>('[data-mm-handle="end"]'),
        bend: host.querySelector<SVGGElement>('[data-mm-handle="bend"]'),
      },
      tangents: {
        start: host.querySelector<SVGLineElement>('[data-mm-tangent="start"]'),
        end: host.querySelector<SVGLineElement>('[data-mm-tangent="end"]'),
      },
      label: host.querySelector<HTMLElement>('[data-mm-line-label]'),
    }
    lineDom.set(id, dom)
    return dom
  }

  const drawLine = (id: string, line: SceneLine): void => {
    lines.set(id, line)
    const dom = domOf(id)
    if (!dom) return
    const d = linePath(line.start, line.end, line.bend)
    dom.stroke?.setAttribute('d', d)
    dom.hit?.setAttribute('d', d)
    dom.select?.setAttribute('d', d)
    const bend = line.bend ?? midpoint(line.start, line.end)
    const ring = (group: SVGGElement | null, at: Point): void => {
      group?.setAttribute('transform', `translate(${at.x} ${at.y})`)
    }
    ring(dom.rings.start, line.start)
    ring(dom.rings.end, line.end)
    ring(dom.rings.bend, bend)
    const look = bendRingLook(line.bend !== null)
    const bendCircle = dom.rings.bend?.querySelector('circle')
    bendCircle?.setAttribute('fill', look.fill)
    bendCircle?.setAttribute('fill-opacity', String(look.fillOpacity))
    const tangent = (element: SVGLineElement | null, to: Point): void => {
      if (!element) return
      element.style.display = line.bend ? '' : 'none'
      element.setAttribute('x1', String(bend.x))
      element.setAttribute('y1', String(bend.y))
      element.setAttribute('x2', String(to.x))
      element.setAttribute('y2', String(to.y))
    }
    tangent(dom.tangents.start, line.start)
    tangent(dom.tangents.end, line.end)
    const labelAt = lineLabelPoint(line)
    if (dom.label) {
      dom.label.style.transform = `translate(${labelAt.x}px, ${labelAt.y}px) translate(-50%, -50%)`
    }
  }

  const reboxLine = (id: string, line: SceneLine, source: ElementBox): void => {
    const absolute = absoluteLine(line, source)
    const points = [absolute.start, absolute.end]
    if (absolute.bend) points.push(absolute.bend)
    const box = lineBox(points)
    positions.set(id, { x: box.x, y: box.y })
    sizes.set(id, { width: box.width, height: box.height })
    const host = hosts.get(id)
    if (host) {
      host.style.transform = `translate(${box.x}px, ${box.y}px)`
      host.style.width = `${box.width}px`
      host.style.height = `${box.height}px`
    }
    drawLine(id, {
      ...line,
      start: relative(absolute.start, box),
      end: relative(absolute.end, box),
      bend: absolute.bend ? relative(absolute.bend, box) : null,
    })
  }

  const lineSourceBox = (id: string): ElementBox | undefined => {
    const element = elementsById.get(id)
    if (!element?.line) return undefined
    const move = lineMoves.get(id) ?? { x: 0, y: 0 }
    return {
      x: element.x + move.x,
      y: element.y + move.y,
      width: element.width,
      height: element.height,
    }
  }

  return {
    positionOf(id) {
      const line = lines.get(id)
      const original = elementsById.get(id)
      const move = lineMoves.get(id)
      if (line && original && move && (line.startAt || line.endAt)) {
        return { x: original.x + move.x, y: original.y + move.y }
      }
      return positions.get(id)
    },
    boxOf,
    drawnBoxOf,
    hostFor: (id) => hosts.get(id) ?? null,
    labelFor: (id) => hosts.get(id)?.querySelector<HTMLElement>('.mm-label') ?? null,

    writePositions(ids, at) {
      for (const id of ids) {
        const host = hosts.get(id)
        if (!host) continue
        const point = at(id)
        if (!point) continue
        const line = lines.get(id)
        const original = elementsById.get(id)
        if (line && original && (line.startAt || line.endAt)) {
          lineMoves.set(id, { x: point.x - original.x, y: point.y - original.y })
          continue
        }
        positions.set(id, point)
        host.style.transform = `translate(${point.x}px, ${point.y}px)`
      }
    },

    writeBox(id, box) {
      const host = hosts.get(id)
      if (!host) return
      positions.set(id, { x: box.x, y: box.y })
      sizes.set(id, {
        width: box.width,
        height: box.height,
        underline: sizes.get(id)?.underline,
      })
      host.style.transform = `translate(${box.x}px, ${box.y}px)`
      host.style.width = `${box.width}px`
      host.style.height = `${box.height}px`
      redrawShape(host, box.width, box.height)
    },

    writeZoom(zoom) {
      if (zoom === cameraZoom) return
      cameraZoom = zoom
      zoomRoot.style.setProperty('--mm-zoom', String(zoom))
    },

    incidentEdges(ids) {
      // Deduplicated because an edge between two moving elements would otherwise be repainted
      // twice per frame, which on a 120-member frame drag is not a rounding error.
      const seen = new Set<string>()
      for (const id of ids) {
        for (const edgeId of incident.get(id) ?? []) seen.add(edgeId)
      }
      return [...seen]
    },

    linesToRepaint(ids) {
      const seen = new Set<string>()
      for (const id of ids) {
        for (const lineId of attachedTo.get(id) ?? []) seen.add(lineId)
        const line = lines.get(id)
        if (line && (line.startAt || line.endAt)) seen.add(id)
      }
      return [...seen]
    },

    repaintLines(lineIds) {
      for (const id of lineIds) {
        const content = contentOf.get(id)
        const source = lineSourceBox(id)
        if (!content || !source) continue
        reboxLine(id, resolveLine(content, source, targetOf), source)
      }
    },

    lineOf: (id) => lines.get(id),

    rotationOf: (id) => rotations.get(id) ?? 0,

    writeLine(id, line) {
      const previous = lines.get(id)
      const box = boxOf(id)
      if (!previous || !box) return
      const start = relative(line.start, box)
      const end = relative(line.end, box)
      const bend = line.bend ? relative(line.bend, box) : null
      const points = [line.start, line.end]
      if (line.bend) points.push(line.bend)
      drawLine(id, {
        ...previous,
        start,
        end,
        bend,
        startAt: line.startAt,
        endAt: line.endAt,
        extent: extentOf(points, previous.thickness, previous.startCap, previous.endCap),
      })
    },

    writeRotation(id, degrees) {
      rotations.set(id, degrees)
      const rotor = hosts.get(id)?.querySelector<HTMLElement>('[data-mm-rotor]')
      if (rotor) rotor.style.rotate = `${degrees}deg`
    },

    anchorTargets() {
      // Walks the scene, so it is asked once per gesture and never per pointer move.
      const targets: AnchorTarget[] = []
      for (const element of scene.elements) {
        if (element.kind !== 'node' && element.kind !== 'shape') continue
        const target = targetOf(element.id)
        if (target) targets.push(target)
      }
      return targets
    },

    repaintEdges(edgeIds) {
      for (const edgeId of edgeIds) {
        const edge = edgesById.get(edgeId)
        if (!edge) continue
        const path = paths.get(edgeId)
        const label = labels.get(edgeId)
        // In canvas mode there is no path and most edges carry no label, so this is the branch
        // that makes the whole loop free rather than a second cost on top of the redraw.
        if (!path && !label) continue
        const from = boxOf(edge.fromId)
        const to = boxOf(edge.toId)
        if (!from || !to) continue
        // The shape rather than the geometry, so a labelled edge in canvas mode does not build a
        // path string that no element will ever read. Routed through the same decision the canvas
        // renderer makes, or a tapered branch would repaint as a plain stroke the moment it moved.
        const anchors = anchorsFor(from, to)
        if (path) path.setAttribute('d', strokeToPathData(strokeFor(edge, anchors)))
        if (label) {
          const at = edgeShape(edge.routing ?? 'curve', anchors).label
          label.style.transform = `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`
        }
      }
    },

    rebindEdgeDom(substrate) {
      mode = substrate
      readEdgeDom()
    },

    allEdgeIds: () => [...edgesById.keys()],

    cullTargets() {
      const targets: CullTarget[] = []

      for (const element of scene.elements) {
        const host = hosts.get(element.id)
        if (!host) continue
        targets.push({
          key: nodeCullKey(element.id),
          nodes: [host],
          // Both read inside rather than captured outside: a resize replaces the size entry, and a
          // target holding the one from build time would keep the culler working off the old box.
          bounds: (): CullBounds | undefined => {
            return drawnBoxOf(element.id)
          },
        })
      }

      // Nothing to index when no edges are drawn at all. Registering them anyway would charge
      // the diagnostic edges-off arm for a grid it cannot use, which is the one arm whose whole
      // job is to report what the edge layer costs.
      for (const edge of mode === 'off' ? [] : scene.edges) {
        // Whatever DOM this edge owns, which in canvas mode is a label or nothing. The culler
        // hides nodes by style, so an empty list is a target it will never try to hide, and the
        // canvas mode's edges are culled by the renderer simply not drawing them.
        const nodes: CullableNode[] = []
        const path = paths.get(edge.id)
        if (path) nodes.push(path)
        const label = labels.get(edge.id)
        if (label) nodes.push(label)
        targets.push({
          key: edgeCullKey(edge.id),
          nodes,
          // What the canvas mode is actually handed each frame. Without it the culler's visible-edge
          // set stays empty and the canvas clears and transforms and then draws nothing at all, which
          // looks exactly like a camera parked off the map.
          edgeId: edge.id,
          bounds: (): CullBounds | undefined => {
            const from = drawnBoxOf(edge.fromId)
            const to = drawnBoxOf(edge.toId)
            if (!from || !to) return undefined
            // The union of both endpoints. An edge is a curve inside that box for every routing
            // here, so the box is a correct conservative cover rather than an approximation.
            const x = Math.min(from.x, to.x)
            const y = Math.min(from.y, to.y)
            return {
              x,
              y,
              width: Math.max(from.x + from.width, to.x + to.width) - x,
              height: Math.max(from.y + from.height, to.y + to.height) - y,
            }
          },
        })
      }

      return targets
    },

    setSelected(ids) {
      for (const id of selected) hosts.get(id)?.removeAttribute('data-selected')
      // The value says how many, not which, so chrome that only makes sense for one thing at a time
      // can be a CSS variant rather than a second render. Resize grips are the case: eight of them
      // on every member of a twenty-element sweep is noise, and there is nothing sensible for one
      // of them to do to a set.
      const value = ids.length === 1 ? 'one' : 'many'
      for (const id of ids) {
        const host = hosts.get(id)
        if (!host) continue
        host.setAttribute('data-selected', value)
      }
      selected = [...ids]
    },
  }
}

/**
 * A shape's outline after its box changed under it.
 *
 * The path is drawn to the box rather than scaled into it, which is the same reason it is a path at
 * all: scaling would stretch the stroke and the corner radius with the shape, and the radius is
 * matching a CSS one, which does not stretch. Reading the shape off the element rather than being
 * told it keeps the resize gesture from having to know what a shape is.
 */
function redrawShape(host: HTMLElement, width: number, height: number): void {
  const path = host.querySelector<SVGPathElement>('path[data-mm-shape]')
  const shape = path?.dataset.mmShape
  if (!path || !shape) return
  const svg = path.ownerSVGElement
  if (svg) {
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
  }
  path.setAttribute('d', shapePath(shape as ShapeType, width, height))
}
