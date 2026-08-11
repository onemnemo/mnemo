/**
 * How thick a branch is at a given depth.
 *
 * One table, two consumers, and they have to agree: the tapering edge that arrives at a node, and the
 * rule the node draws under its own text. A plain node has no box for the branch to meet, so the
 * branch lands on that rule and the rule carries straight on from it. When the two numbers disagree
 * the join shows as a step, and that continuity is most of what separates a mindmap from a flowchart.
 */

/** Trunk to twig. Beyond the table a branch stops thinning, or deep maps dissolve into hairlines. */
const WIDTHS = [7, 3.5, 2.4, 2, 2] as const

export function branchWidth(depth: number): number {
  if (depth <= 0) {
    return WIDTHS[0]
  }
  return WIDTHS[Math.min(depth, WIDTHS.length - 1)]
}

/** The same number, named for the node side of the join. */
export const underlineWidth = branchWidth
