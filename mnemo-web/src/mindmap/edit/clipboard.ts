/**
 * Taking a piece of a map away with you, and putting it down again.
 *
 * A copy is a spec rather than a list of ids. The add op already knows how to plant a nested subtree
 * and hand back the ids it made, so a paste of a forty-node branch is one op and one undo step, and
 * nothing has to walk the tree a second time on the way back in. No id crosses over, which is what
 * makes a paste a copy and not a second name for the same node.
 *
 * What a spec carries is content and shape. Per-element style overrides are left behind, because the
 * op vocabulary has nowhere to put them: a pasted branch takes the look its new template gives it.
 * That is the one place a copy is not a copy, and it is the wire format's decision rather than this
 * file's.
 */

import type { ElementContent, MindmapDocument } from "../model/document"
import type { NodeSpec } from "../model/ops"
import { childrenIds, type Hierarchy } from "../scene/hierarchy"

export interface Placement {
  x: number
  y: number
}

/** A capture, and the nodes it was taken from, so a cut removes exactly what it carried off. */
export interface Capture {
  ids: string[]
  specs: NodeSpec[]
}

const NOTHING: Capture = { ids: [], specs: [] }

/**
 * Everything worth copying out of a selection.
 *
 * Only nodes: a shape, a caption or a frame has no place in a spec, since `add` builds nodes and
 * nothing else. And only the ones nothing else selected already holds, because a subtree brings its
 * children along; without that, selecting a branch and its child would plant the child twice.
 *
 * `placeAt` puts each node where it says. Left out, the copy has no coordinates at all, and since
 * layout here is freeform until an arrange is asked for, that means the whole thing lands on the
 * origin in a heap. So every caller passes one: a duplicate offsets from the original, and a copy
 * records where it was so a later paste can move it somewhere as a piece.
 */
export function captureSelection(
  document: MindmapDocument,
  hierarchy: Hierarchy,
  ids: Iterable<string>,
  placeAt?: (id: string) => Placement | undefined,
): Capture {
  const nodes = [...ids].filter((id) => hierarchy.byId.has(id))
  if (nodes.length === 0) {
    return NOTHING
  }

  const contents = new Map<string, ElementContent>()
  for (const element of document.elements ?? []) {
    contents.set(element.id, element.content)
  }

  const capture: Capture = { ids: [], specs: [] }
  for (const id of topLevelIds(hierarchy, nodes)) {
    const spec = captureSubtree(id, contents, hierarchy, placeAt)
    if (spec) {
      capture.ids.push(id)
      capture.specs.push(spec)
    }
  }
  return capture
}

/** The ones with no selected ancestor above them, in the order they were given. */
export function topLevelIds(hierarchy: Hierarchy, ids: readonly string[]): string[] {
  const within = new Set(ids)
  return ids.filter((id) => {
    let parent = hierarchy.byId.get(id)?.parentId ?? null
    while (parent) {
      if (within.has(parent)) {
        return false
      }
      parent = hierarchy.byId.get(parent)?.parentId ?? null
    }
    return true
  })
}

/**
 * Where each node of a duplicate lands, a fixed step from where its original is drawn.
 *
 * Drawn position first and stored position second, because an unpinned node's stored coordinates are
 * whatever the last layout left there and the copy has to appear beside what is on screen. A node
 * inside a collapsed branch is drawn nowhere at all, so for those the stored pair is the only answer
 * there is, and it is the right one: they are invisible either way and the next expand lays them out.
 */
export function offsetPlacement(
  document: MindmapDocument,
  drawn: Iterable<{ id: string; x: number; y: number }>,
  dx: number,
  dy: number,
): (id: string) => Placement | undefined {
  const at = new Map<string, Placement>()
  for (const element of document.elements ?? []) {
    if (element.x !== undefined && element.y !== undefined) {
      at.set(element.id, { x: element.x, y: element.y })
    }
  }
  for (const element of drawn) {
    at.set(element.id, { x: element.x, y: element.y })
  }
  return (id) => {
    const found = at.get(id)
    return found ? { x: found.x + dx, y: found.y + dy } : undefined
  }
}

/**
 * The top-left corner of everything a capture holds, or null when none of it was placed.
 *
 * Every node and not just the tops, because a child can be drawn above or to the left of the node it
 * hangs off, and a paste measured from the tops alone would drop part of the copy outside the spot it
 * was asked for.
 */
export function captureOrigin(specs: readonly NodeSpec[]): Placement | null {
  let x = Infinity
  let y = Infinity
  const visit = (spec: NodeSpec) => {
    if (spec.xy) {
      x = Math.min(x, spec.xy[0])
      y = Math.min(y, spec.xy[1])
    }
    for (const child of spec.c ?? []) {
      visit(child)
    }
  }
  for (const spec of specs) {
    visit(spec)
  }
  return Number.isFinite(x) ? { x, y } : null
}

/**
 * The same copy, moved.
 *
 * As one piece, so a pasted branch arrives looking like the branch it was taken from rather than as a
 * fan the layout has to be asked to sort out.
 */
export function translated(specs: readonly NodeSpec[], dx: number, dy: number): NodeSpec[] {
  return specs.map((spec) => ({
    ...spec,
    ...(spec.xy ? { xy: [spec.xy[0] + dx, spec.xy[1] + dy] as [number, number] } : {}),
    ...(spec.c ? { c: translated(spec.c, dx, dy) } : {}),
  }))
}

/* -------------------------------------------------------------------------- */
/* What is being held                                                         */
/* -------------------------------------------------------------------------- */

let held: readonly NodeSpec[] = []

/**
 * The last copy, kept for the session.
 *
 * Outside React, so a copy survives leaving the map: taking a branch out of one map and putting it
 * into another is the reason to have a clipboard at all, and a copy that emptied itself on the way
 * between them would only ever work within one document. Not the system clipboard, because a subtree
 * is not text and the shape of it would not survive the trip.
 */
export function holdCopy(specs: readonly NodeSpec[]): void {
  held = specs
}

export function heldCopy(): readonly NodeSpec[] {
  return held
}

function captureSubtree(
  id: string,
  contents: ReadonlyMap<string, ElementContent>,
  hierarchy: Hierarchy,
  placeAt?: (id: string) => Placement | undefined,
): NodeSpec | null {
  const content = contents.get(id)
  if (!content) {
    return null
  }

  const spec: NodeSpec = { content }
  const children: NodeSpec[] = []
  for (const childId of childrenIds(hierarchy, id)) {
    const child = captureSubtree(childId, contents, hierarchy, placeAt)
    if (child) {
      children.push(child)
    }
  }
  if (children.length > 0) {
    spec.c = children
  }

  const at = placeAt?.(id)
  if (at) {
    spec.xy = [Math.round(at.x), Math.round(at.y)]
  }
  return spec
}
