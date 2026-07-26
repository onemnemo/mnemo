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

import type { MindmapEdge, MindmapFixture } from '../../fixture/model'
import type { Point } from '../../harness/contract'
import type { CullBounds, CullTarget } from './culler'
import { anchorsFor, edgeGeometry, type ElementBox } from './edge-paths'

/**
 * Cull keys are namespaced because elements and edges share one grid. One grid rather than two
 * keeps a single cell-range comparison per frame, which is the check that makes most frames of
 * a pan cost nothing at all.
 */
export function nodeCullKey(elementId: string): string {
  return `n:${elementId}`
}

export function edgeCullKey(edgeId: string): string {
  return `e:${edgeId}`
}

export interface SceneIndex {
  positionOf(id: string): Point | undefined
  hostFor(id: string): HTMLElement | null
  /** The label span an inline edit would type into, if this element renders one. */
  labelFor(id: string): HTMLElement | null
  /** Writes new positions for exactly these ids. Does not touch edges. */
  writePositions(ids: readonly string[], at: (id: string) => Point | undefined): void
  /** Edge ids with an endpoint among these elements. Computed once per gesture, not per frame. */
  incidentEdges(ids: readonly string[]): readonly string[]
  repaintEdges(edgeIds: readonly string[]): void
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
   */
  cullTargets(): readonly CullTarget[]
}

/**
 * Indexed from the pane rather than from the world, because the edge SVG is a sibling of the
 * world rather than a child of it: it is viewport-sized and carries the camera on an inner
 * group, which is what keeps a pan from paying for a canvas-sized box.
 */
export function createSceneIndex(fixture: MindmapFixture, pane: HTMLElement): SceneIndex {
  const hosts = new Map<string, HTMLElement>()
  for (const host of pane.querySelectorAll<HTMLElement>('.a2-node')) {
    const id = host.dataset.mmId
    if (id) hosts.set(id, host)
  }

  const paths = new Map<string, SVGPathElement>()
  for (const path of pane.querySelectorAll<SVGPathElement>('path[data-mm-edge]')) {
    const id = path.dataset.mmEdge
    if (id) paths.set(id, path)
  }

  const labels = new Map<string, HTMLElement>()
  for (const label of pane.querySelectorAll<HTMLElement>('[data-mm-edge-label]')) {
    const id = label.dataset.mmEdgeLabel
    if (id) labels.set(id, label)
  }

  const positions = new Map<string, Point>()
  const sizes = new Map<string, { readonly width: number; readonly height: number }>()
  for (const element of fixture.elements) {
    positions.set(element.id, { x: element.x, y: element.y })
    sizes.set(element.id, { width: element.width, height: element.height })
  }

  const edgesById = new Map<string, MindmapEdge>()
  const incident = new Map<string, string[]>()
  const attach = (elementId: string, edgeId: string): void => {
    const list = incident.get(elementId)
    if (list) list.push(edgeId)
    else incident.set(elementId, [edgeId])
  }
  for (const edge of fixture.edges) {
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
    hostFor: (id) => hosts.get(id) ?? null,
    labelFor: (id) => hosts.get(id)?.querySelector<HTMLElement>('.spike-label') ?? null,

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
        const path = paths.get(edgeId)
        if (!edge || !path) continue
        const from = boxOf(edge.fromId)
        const to = boxOf(edge.toId)
        if (!from || !to) continue
        const geometry = edgeGeometry(edge.routing ?? 'curve', anchorsFor(from, to))
        path.setAttribute('d', geometry.path)
        const label = labels.get(edgeId)
        if (label) {
          label.style.transform =
            `translate(-50%, -50%) translate(${geometry.label.x}px, ${geometry.label.y}px)`
        }
      }
    },

    allEdgeIds: () => [...edgesById.keys()],

    cullTargets() {
      const targets: CullTarget[] = []

      for (const element of fixture.elements) {
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

      for (const edge of fixture.edges) {
        const path = paths.get(edge.id)
        if (!path) continue
        const label = labels.get(edge.id)
        targets.push({
          key: edgeCullKey(edge.id),
          nodes: label ? [path, label] : [path],
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
