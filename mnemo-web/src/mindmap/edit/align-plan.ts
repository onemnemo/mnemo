/**
 * What an align does to a selection, as opposed to what it does to a list of boxes.
 *
 * Two things separate the two. A frame has no position of its own worth writing: its box is derived
 * from wherever its members are, so lining a frame up means translating everything inside it, exactly
 * as dragging one does. And a member of a selected frame must not be lined up on its own account in
 * the same batch, or it would be moved twice for one press and land somewhere neither answer wanted.
 */

import { computeAlign, DISTRIBUTE_MIN, type AlignBox, type AlignMove, type AlignOp } from "./align"
import type { Point } from "../model/scene"

/** One selected element, as much of it as aligning needs to know. */
export interface AlignCandidate extends AlignBox {
  /** The ids this element carries when it moves. Only a frame has any. */
  readonly members?: readonly string[]
}

/** The elements an align acts on directly: everything selected that a selected frame is not holding. */
export function alignTargets(selected: readonly AlignCandidate[]): AlignCandidate[] {
  const carried = new Set<string>()
  for (const candidate of selected) {
    for (const id of candidate.members ?? []) {
      carried.add(id)
    }
  }
  return carried.size === 0 ? [...selected] : selected.filter((candidate) => !carried.has(candidate.id))
}

/** Whether spreading out is on offer, which needs something between the two anchors to spread. */
export function canDistribute(selected: readonly AlignCandidate[]): boolean {
  return alignTargets(selected).length >= DISTRIBUTE_MIN
}

/**
 * Every move one press should commit, the carried members included.
 *
 * `originOf` answers for members, which are by definition not in the selection and so not among the
 * candidates. A membership list can name an element that is no longer there, which is not an error:
 * the rest of the frame still moves.
 */
export function planAlign(
  op: AlignOp,
  selected: readonly AlignCandidate[],
  originOf: (id: string) => Point | undefined,
): AlignMove[] {
  const targets = alignTargets(selected)
  const moves = computeAlign(op, targets)
  if (moves.length === 0) {
    return []
  }

  const byId = new Map(targets.map((target) => [target.id, target] as const))
  const planned: AlignMove[] = [...moves]
  // First frame to claim a member carries it, matching how membership is read everywhere else. Two
  // frames naming the same element is not a shape the tools produce, but it is one a file can hold.
  const claimed = new Set<string>()

  for (const move of moves) {
    const frame = byId.get(move.id)
    if (!frame?.members?.length) {
      continue
    }
    const dx = move.x - frame.x
    const dy = move.y - frame.y
    for (const id of frame.members) {
      if (claimed.has(id)) {
        continue
      }
      claimed.add(id)
      const origin = originOf(id)
      if (origin) {
        planned.push({ id, x: origin.x + dx, y: origin.y + dy })
      }
    }
  }

  return planned
}
