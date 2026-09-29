/** What the ring does to its targets, one batch per pick so each is one undo. */

import type { EdgeStyle, ElementStyle, MindmapDocument, NodeShape } from "../model/document"
import { op, type MindmapOp } from "../model/ops"
import { adoptPlan, connectOps, forestOf, planConnect } from "./connect-plan"

export interface RingTarget {
  readonly id: string
  readonly isNode: boolean
  readonly pinned?: boolean
  readonly collapsed?: boolean
  readonly hasChildren: boolean
}

function style(ids: readonly string[], patch: ElementStyle): MindmapOp[] {
  if (ids.length === 0) {
    return []
  }
  return [ids.length === 1 ? op.set(ids[0], { style: patch }) : op.styleIds([...ids], patch)]
}

/** A branch colour on every target. */
export function colorOps(targets: readonly RingTarget[], token: string): MindmapOp[] {
  return style(
    targets.map((target) => target.id),
    { stroke: token },
  )
}

/** A node shape on the targets that are nodes; the rest have no such thing. */
export function nodeShapeOps(targets: readonly RingTarget[], nodeShape: NodeShape): MindmapOp[] {
  return style(
    targets.filter((target) => target.isNode).map((target) => target.id),
    { nodeShape },
  )
}

/** Whether a collapse pick expands: every target with something under it is already folded. */
export function collapseExpands(targets: readonly RingTarget[]): boolean {
  const branchy = targets.filter((target) => target.hasChildren)
  return branchy.length > 0 && branchy.every((target) => target.collapsed === true)
}

/** Folds every target branch, or unfolds them all when they already are. */
export function collapseOps(targets: readonly RingTarget[]): MindmapOp[] {
  const collapsed = !collapseExpands(targets)
  return targets.filter((target) => target.hasChildren).map((target) => op.set(target.id, { collapsed }))
}

/** Whether a pin pick unpins: every target node is already pinned. */
export function pinUnpins(targets: readonly RingTarget[]): boolean {
  const nodes = targets.filter((target) => target.isNode)
  return nodes.length > 0 && nodes.every((target) => target.pinned === true)
}

/** Pins every target node, or lets them all go when they already are. */
export function pinOps(targets: readonly RingTarget[]): MindmapOp[] {
  const pinned = !pinUnpins(targets)
  return targets.filter((target) => target.isNode).map((target) => op.set(target.id, { pinned }))
}

/**
 * Connects the primary to each other target, skipping pairs already joined either way. Each pair is
 * planned as a single connect would be, on top of the pairs before it in the same batch.
 */
export function connectManyOps(
  primary: string,
  others: readonly string[],
  document: Pick<MindmapDocument, "elements" | "edges"> | undefined,
  linkStyle?: EdgeStyle,
): MindmapOp[] {
  const edges = document?.edges ?? []
  const joined = (a: string, b: string) =>
    edges.some((edge) => (edge.fromId === a && edge.toId === b) || (edge.fromId === b && edge.toId === a))
  const forest = forestOf(document)
  return others
    .filter((other) => other !== primary && !joined(primary, other))
    .flatMap((other) => {
      const plan = planConnect(forest, primary, other)
      const ops = connectOps(forest, plan, primary, other, linkStyle)
      adoptPlan(forest, plan)
      return ops
    })
}
