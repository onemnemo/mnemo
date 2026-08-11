/**
 * Where each node sits in the forest: parent, depth, sibling order, and which branch owns it.
 *
 * The tree is not stored. It is the hierarchy edges, in their array order, and that order is the
 * sibling order the layout and the branch ramp both read. So this walk is the only definition of
 * "the third child of the second branch" the client has, and it mirrors the desktop's
 * `MindmapViewModel.BuildStyleContexts` deliberately: a map must not colour its branches differently
 * in two apps reading the same file.
 */

import { edgeKind, elementKind, type MindmapDocument } from "../model/document"

export interface HierarchyNode {
  readonly id: string
  readonly parentId: string | null
  /** The root of this node's cluster; a root is its own. */
  readonly rootId: string
  /** Distance from the root, 0 for a root. */
  readonly depth: number
  /** The depth-1 ancestor's index among its root's children; -1 for a root. */
  readonly branch: number
  /** Index among siblings, in hierarchy-edge order. */
  readonly order: number
  /** An ancestor is collapsed, so this node is laid out nowhere and drawn not at all. */
  readonly hidden: boolean
}

export interface Hierarchy {
  readonly byId: ReadonlyMap<string, HierarchyNode>
  /** Roots in document element order, so a redraw does not reshuffle the clusters. */
  readonly rootIds: readonly string[]
  readonly childrenOf: ReadonlyMap<string, readonly string[]>
}

const NO_CHILDREN: readonly string[] = []

export function analyzeHierarchy(document: MindmapDocument): Hierarchy {
  const byId = new Map<string, HierarchyNode>()
  const childrenOf = new Map<string, string[]>()
  const rootIds: string[] = []

  const nodeIds = new Set<string>()
  for (const element of document.elements ?? []) {
    if (elementKind(element) === "node") {
      nodeIds.add(element.id)
    }
  }
  if (nodeIds.size === 0) {
    return { byId, rootIds, childrenOf }
  }

  // An edge to or from something that is not a node is not hierarchy, whatever it calls itself. A
  // shape cannot parent a node, and a node whose only parent edge points at one is a root.
  const parentOf = new Map<string, string>()
  for (const edge of document.edges ?? []) {
    if (edgeKind(edge) !== "hierarchy" || !nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) {
      continue
    }
    // First parent wins. The server enforces one, but a hand-edited file is still a file we open.
    if (parentOf.has(edge.toId)) {
      continue
    }
    parentOf.set(edge.toId, edge.fromId)
    const kids = childrenOf.get(edge.fromId)
    if (kids) {
      kids.push(edge.toId)
    } else {
      childrenOf.set(edge.fromId, [edge.toId])
    }
  }

  const collapsed = new Set<string>()
  for (const element of document.elements ?? []) {
    if (element.collapsed) {
      collapsed.add(element.id)
    }
  }

  for (const element of document.elements ?? []) {
    if (elementKind(element) !== "node" || parentOf.has(element.id)) {
      continue
    }

    const rootId = element.id
    rootIds.push(rootId)
    byId.set(rootId, { id: rootId, parentId: null, rootId, depth: 0, branch: -1, order: 0, hidden: false })

    // Iterative rather than recursive: depth is unbounded in the data, and a map deep enough to blow
    // the stack should draw slowly, not fail to open.
    const stack: HierarchyNode[] = [byId.get(rootId)!]
    while (stack.length > 0) {
      const node = stack.pop()!
      const kids = childrenOf.get(node.id)
      if (!kids) {
        continue
      }

      const hiddenBelow = node.hidden || collapsed.has(node.id)
      for (let i = 0; i < kids.length; i++) {
        const id = kids[i]
        // A cycle cannot reach here through the server, which refuses to write one, but it can reach
        // here through a file. Claiming the first arrival keeps the walk finite either way.
        if (byId.has(id)) {
          continue
        }
        const child: HierarchyNode = {
          id,
          parentId: node.id,
          rootId,
          depth: node.depth + 1,
          // A depth-1 child seeds a branch; everything under it inherits that branch's colour.
          branch: node.depth === 0 ? i : node.branch,
          order: i,
          hidden: hiddenBelow,
        }
        byId.set(id, child)
        stack.push(child)
      }
    }
  }

  return { byId, rootIds, childrenOf }
}

export function childrenIds(hierarchy: Hierarchy, id: string): readonly string[] {
  return hierarchy.childrenOf.get(id) ?? NO_CHILDREN
}

/**
 * Every descendant of a node, flattened, collapsed ones included.
 *
 * Collapsed ones included is the point: they are absent from the scene but present in the document
 * with stored coordinates, so a drag that skipped them would leave them where they were and expanding
 * the node afterwards would find its children scattered back at the old place.
 */
export function descendantsOf(hierarchy: Hierarchy, id: string): string[] {
  const found: string[] = []
  const stack = [...childrenIds(hierarchy, id)]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!seen.add(current)) {
      continue
    }
    found.push(current)
    stack.push(...childrenIds(hierarchy, current))
  }
  return found
}

/** How many nodes a collapse is hiding, for the chip that says so. */
export function hiddenDescendantCount(hierarchy: Hierarchy, id: string): number {
  let count = 0
  const stack = [...childrenIds(hierarchy, id)]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!seen.add(current)) {
      continue
    }
    count++
    stack.push(...childrenIds(hierarchy, current))
  }
  return count
}
