import type { ReactNode } from "react"

import type { CanvasRuntime } from "../canvas/runtime"
import type { SceneIndex } from "../canvas/scene-index"
import type { Selection } from "../interaction/selection"
import type { EdgeStyle, ElementStyle } from "../model/document"
import type { Point, Scene, SceneEdge } from "../model/scene"
import { boxesAnchor, edgeAnchor } from "./anchor"
import { EdgeBar } from "./EdgeBar"
import { NodeBar, type BranchControl } from "./NodeBar"
import { useBarAnchor, type Held } from "./useBarAnchor"

export interface SelectionBarProps {
  scene: Scene
  selection: Selection
  runtime: Held<CanvasRuntime>
  /** The pane the bar is kept inside. Its own size is what the clamping is against. */
  pane: Held<HTMLElement>
  /** A null member takes a style away rather than setting it; `deep` sends it down the branch too. */
  onEdgeStyle: (patch: EdgeStyle, deep: boolean) => void
  onNodeStyle: (patch: ElementStyle) => void
  onEdgeLabel: (edgeId: string) => void
  branch: BranchControl | null
  /** Save the selected branch's styling as a template; null when the selection is not one branch. */
  onSaveTemplate: (() => void) | null
}

/**
 * The bar over whatever is selected.
 *
 * One component for both bars because the hard part is shared and the easy part is not: placing a
 * bar over a moving thing inside a pane it must not leave is the same problem for an edge and for a
 * node, while what goes on the bar is entirely different. So this owns the anchoring and hands the
 * contents off.
 *
 * A selection that mixes edges with elements, or that includes a shape or a caption, gets no bar.
 * There is no honest set of controls for "these four things, two of which have no shape and one of
 * which has no text", and a bar that greyed out most of itself would be worse than no bar.
 */
export function MindmapSelectionBar({
  scene,
  selection,
  runtime,
  pane,
  onEdgeStyle,
  onNodeStyle,
  onEdgeLabel,
  branch,
  onSaveTemplate,
}: SelectionBarProps) {
  if (selection.edges.size > 0 && selection.elements.size > 0) {
    return null
  }

  if (selection.primary?.kind === "edge") {
    const edge = scene.edges.find((candidate) => candidate.id === selection.primary?.id)
    if (!edge) {
      return null
    }
    return (
      <Anchored runtime={runtime} pane={pane} locate={locateEdge(edge)}>
        <EdgeBar
          edge={edge}
          count={selection.edges.size}
          onStyle={onEdgeStyle}
          onLabel={() => onEdgeLabel(edge.id)}
        />
      </Anchored>
    )
  }

  const ids = [...selection.elements]
  const elements = ids.map((id) => scene.elements.find((candidate) => candidate.id === id))
  const primary = elements.find((element) => element?.id === selection.primary?.id)
  if (!primary || elements.some((element) => element?.kind !== "node")) {
    return null
  }

  return (
    <Anchored runtime={runtime} pane={pane} locate={locateElements(ids)}>
      <NodeBar
        element={primary}
        count={ids.length}
        onStyle={onNodeStyle}
        branch={branch}
        onSaveTemplate={onSaveTemplate}
      />
    </Anchored>
  )
}

/**
 * The frame the bar is positioned in.
 *
 * Its own element, separate from the bar it holds, because the bar animates in with a scale and the
 * offset that puts its bottom edge on the anchor is a transform too. One element cannot carry both:
 * the animation would win and the bar would open in the wrong place for as long as it ran.
 */
function Anchored({
  runtime,
  pane,
  locate,
  children,
}: {
  runtime: Held<CanvasRuntime>
  pane: Held<HTMLElement>
  locate: (index: SceneIndex) => Point | null
  children: ReactNode
}) {
  const bar = useBarAnchor(runtime, pane, locate)
  return (
    <div
      ref={bar}
      className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-full"
      style={{ left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>
  )
}

/** Where an edge's bar hangs: over the edge's own label point, which is shape-aware. */
function locateEdge(edge: SceneEdge): (index: SceneIndex) => Point | null {
  return (index) => {
    const from = index.boxOf(edge.fromId)
    const to = index.boxOf(edge.toId)
    return from && to ? edgeAnchor(edge.routing ?? "curve", from, to) : null
  }
}

/** Where a node bar hangs: over the top edge of everything selected, centred across all of it. */
function locateElements(ids: readonly string[]): (index: SceneIndex) => Point | null {
  return (index) => {
    const boxes = []
    for (const id of ids) {
      const box = index.boxOf(id)
      if (box) {
        boxes.push(box)
      }
    }
    return boxesAnchor(boxes)
  }
}
