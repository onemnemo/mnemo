/**
 * The geometry behind a selected edge's highlight, and the hand-written repaint that moves it.
 *
 * Separate from the component because it is used from both sides of the same drawing: React writes
 * it when the selection changes, and a drag rewrites the same attributes at pointer rate without
 * going near React. Keeping one geometry function is what stops those two from disagreeing.
 */

import { anchorsFor, edgeGeometry, type ElementBox } from "./edge-paths"
import type { Point, Scene, SceneEdge } from "../model/scene"

export interface HighlightGeometry {
  readonly path: string
  readonly start: Point
  readonly end: Point
}

export type BoxLookup = (id: string) => ElementBox | undefined

export function highlightGeometry(edge: SceneEdge, boxOf: BoxLookup): HighlightGeometry | null {
  const from = boxOf(edge.fromId)
  const to = boxOf(edge.toId)
  if (!from || !to) {
    return null
  }

  const anchors = anchorsFor(from, to)
  const geometry = edgeGeometry(edge.routing ?? "curve", anchors)
  return {
    path: geometry.path,
    start: { x: anchors.sx, y: anchors.sy },
    end: { x: anchors.tx, y: anchors.ty },
  }
}

/**
 * A repaint bound to one scene.
 *
 * Bound rather than free so the edge lookup is built once per scene instead of once per frame of a
 * drag, and it takes `boxOf` rather than reading the scene's own coordinates, because during a drag
 * the live position of a moving element is in the index while the scene still holds where it began.
 *
 * Reads the ids out of the DOM rather than taking a list, so it cannot disagree with what is drawn.
 */
export function createSelectionRepainter(
  scene: Scene,
  boxOf: BoxLookup,
): (root: SVGGElement | null) => void {
  const byId = new Map(scene.edges.map((edge) => [edge.id, edge]))

  return (root) => {
    if (!root) {
      return
    }
    for (const group of root.querySelectorAll<SVGGElement>("[data-mm-selected-edge]")) {
      const edge = byId.get(group.dataset.mmSelectedEdge ?? "")
      const drawn = edge ? highlightGeometry(edge, boxOf) : null
      if (!drawn) {
        continue
      }
      group.querySelector("path")?.setAttribute("d", drawn.path)
      const [start, end] = group.querySelectorAll("circle")
      start?.setAttribute("cx", String(drawn.start.x))
      start?.setAttribute("cy", String(drawn.start.y))
      end?.setAttribute("cx", String(drawn.end.x))
      end?.setAttribute("cy", String(drawn.end.y))
    }
  }
}
