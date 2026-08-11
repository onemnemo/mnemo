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

import type { SceneEdge, Scene } from '../model/scene'
import type { Point } from '../model/scene'
import type { CullableNode, CullBounds, CullTarget } from './culler'
import { strokeFor } from './edge-canvas'
import { anchorsFor, edgeShape, strokeToPathData, type ElementBox } from './edge-paths'
import type { EdgeMode } from './edge-style'

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

export interface SceneIndex {
  positionOf(id: string): Point | undefined
  /** The live box of an element, which is what an edge is drawn between. */
  boxOf(id: string): ElementBox | undefined
  hostFor(id: string): HTMLElement | null
  /** The label span an inline edit would type into, if this element renders one. */
  labelFor(id: string): HTMLElement | null
  /** Writes new positions for exactly these ids. Does not touch edges. */
  writePositions(ids: readonly string[], at: (id: string) => Point | undefined): void
  /** Edge ids with an endpoint among these elements. Computed once per gesture, not per frame. */
  incidentEdges(ids: readonly string[]): readonly string[]
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
): SceneIndex {
  const hosts = new Map<string, HTMLElement>()
  for (const host of pane.querySelectorAll<HTMLElement>('.mm-node')) {
    const id = host.dataset.mmId
    if (id) hosts.set(id, host)
  }

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
    return position && size ? { x: position.x, y: position.y, ...size } : undefined
  }

  let selected: readonly string[] = []

  return {
    positionOf: (id) => positions.get(id),
    boxOf,
    hostFor: (id) => hosts.get(id) ?? null,
    labelFor: (id) => hosts.get(id)?.querySelector<HTMLElement>('.mm-label') ?? null,

    writePositions(ids, at) {
      for (const id of ids) {
        const host = hosts.get(id)
        if (!host) continue
        const point = at(id)
        if (!point) continue
        positions.set(id, point)
        host.style.transform = `translate(${point.x}px, ${point.y}px)`
      }
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
        const size = sizes.get(element.id)
        targets.push({
          key: nodeCullKey(element.id),
          nodes: [host],
          bounds: (): CullBounds | undefined => {
            const position = positions.get(element.id)
            return position && size ? { x: position.x, y: position.y, ...size } : undefined
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
            const from = boxOf(edge.fromId)
            const to = boxOf(edge.toId)
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
      for (const id of ids) hosts.get(id)?.setAttribute('data-selected', '1')
      selected = [...ids]
    },
  }
}
