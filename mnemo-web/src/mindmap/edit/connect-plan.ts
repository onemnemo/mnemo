/**
 * What drawing a connector between two elements writes: a branch that puts one node under the
 * other, or a plain link.
 *
 * A branch is what makes the joined node part of the tree, and so part of every arrange after it.
 * A link joins two things without saying either belongs to the other, which is all it can say when
 * both already have a place in a tree, when either end is not a node, when the branch would loop, or
 * when the node that would move sits in a frame, since arrange leaves framed nodes where they are.
 */

import { edgeKind, elementKind, type EdgeStyle, type FrameContent, type MindmapDocument } from "../model/document"
import { op, type MindmapOp } from "../model/ops"

/** The hierarchy as connecting needs it. Mutable, so a batch can plan each pair on top of the last. */
export interface ConnectForest {
  readonly nodes: ReadonlySet<string>
  readonly parent: Map<string, string>
  readonly children: Map<string, string[]>
  readonly collapsed: Set<string>
  readonly pinned: Set<string>
  readonly framed: ReadonlySet<string>
}

export type ConnectPlan =
  | { readonly kind: "branch"; readonly child: string; readonly parent: string }
  | { readonly kind: "link" }

export function forestOf(document: Pick<MindmapDocument, "elements" | "edges"> | undefined): ConnectForest {
  const nodes = new Set<string>()
  const collapsed = new Set<string>()
  const pinned = new Set<string>()
  const framed = new Set<string>()
  for (const element of document?.elements ?? []) {
    const kind = elementKind(element)
    if (kind === "frame") {
      for (const id of (element.content as FrameContent).childIds ?? []) framed.add(id)
    }
    if (kind !== "node") continue
    nodes.add(element.id)
    if (element.collapsed) collapsed.add(element.id)
    if (element.pinned) pinned.add(element.id)
  }
  const parent = new Map<string, string>()
  const children = new Map<string, string[]>()
  for (const edge of document?.edges ?? []) {
    if (edgeKind(edge) !== "hierarchy" || !nodes.has(edge.fromId) || !nodes.has(edge.toId)) continue
    parent.set(edge.toId, edge.fromId)
    const kids = children.get(edge.fromId)
    if (kids) kids.push(edge.toId)
    else children.set(edge.fromId, [edge.toId])
  }
  return { nodes, parent, children, collapsed, pinned, framed }
}

/** How many nodes hang below `id`. Guarded, since a document from elsewhere can hold a loop. */
function descendants(forest: ConnectForest, id: string): number {
  const seen = new Set<string>([id])
  const stack = [...(forest.children.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...(forest.children.get(next) ?? []))
  }
  return seen.size - 1
}

/** Whether `id` is `ancestor` or sits somewhere under it. */
function within(forest: ConnectForest, id: string, ancestor: string): boolean {
  const seen = new Set<string>()
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = forest.parent.get(at)) {
    if (at === ancestor) return true
    seen.add(at)
  }
  return false
}

/**
 * The end without a parent goes under the other. When both are free the smaller tree goes under
 * the larger, and a tie puts `to` under `from`, the direction the drag was drawn in.
 */
export function planConnect(
  forest: ConnectForest,
  from: string,
  to: string,
  options: { readonly link?: boolean } = {},
): ConnectPlan {
  if (options.link || from === to || !forest.nodes.has(from) || !forest.nodes.has(to)) {
    return { kind: "link" }
  }
  const fromFree = !forest.parent.has(from)
  const toFree = !forest.parent.has(to)
  let child: string
  if (fromFree && toFree) {
    child = descendants(forest, from) < descendants(forest, to) ? from : to
  } else if (toFree) {
    child = to
  } else if (fromFree) {
    child = from
  } else {
    return { kind: "link" }
  }
  const parent = child === to ? from : to
  if (within(forest, parent, child) || forest.framed.has(child)) return { kind: "link" }
  return { kind: "branch", child, parent }
}

/** Records a planned branch and the ops it writes, so the next pair in the same batch is planned against it. */
export function adoptPlan(forest: ConnectForest, plan: ConnectPlan): void {
  if (plan.kind !== "branch") return
  forest.collapsed.delete(plan.parent)
  forest.pinned.delete(plan.child)
  forest.parent.set(plan.child, plan.parent)
  const kids = forest.children.get(plan.parent)
  if (kids) kids.push(plan.child)
  else forest.children.set(plan.parent, [plan.child])
}

/**
 * The ops a plan writes, read against the forest before `adoptPlan`. A branch opens a folded parent
 * so the new child is seen, and unpins the child so the next arrange lays it out with its tree. The
 * connector preset styles links only; a branch takes the branch style.
 */
export function connectOps(
  forest: ConnectForest,
  plan: ConnectPlan,
  from: string,
  to: string,
  linkStyle?: EdgeStyle,
): MindmapOp[] {
  if (plan.kind === "link") return [op.link(from, to, linkStyle ? { style: linkStyle } : undefined)]
  const ops: MindmapOp[] = [op.reparent(plan.child, plan.parent)]
  if (forest.pinned.has(plan.child)) ops.push(op.set(plan.child, { pinned: false }))
  if (forest.collapsed.has(plan.parent)) ops.push(op.set(plan.parent, { collapsed: false }))
  return ops
}
