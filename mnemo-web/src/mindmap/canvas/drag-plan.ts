/**
 * What moves when a drag starts, and where everything was when it did.
 *
 * The semantics here are the ones A1 measured and passed: frame membership is an explicit id
 * list rather than derived containment, origins are snapshotted once at drag start, and every
 * subsequent position is written as origin plus TOTAL delta rather than by accumulating a
 * per-event delta. Accumulation drifts over a long gesture, and members drifting apart from
 * their frame is precisely the failure this design exists to prevent.
 *
 * What is different here is that there is no change-list to intercept. A hand-rolled arm owns
 * the gesture outright, so the moving set is computed once, up front, and the per-frame work is
 * a walk over that set rather than over the document.
 *
 * The set is deduplicated for a reason that outlives the spike: a member of a dragged frame can
 * also be independently selected, and writing it from both paths would land it in the right
 * place while emitting two operations for one element. That list is what a server receives.
 */

import type { Point } from '../model/scene'

export interface DragPlan {
  /** Every element this gesture moves, deduplicated, pressed element first. */
  readonly ids: readonly string[]
  readonly origins: ReadonlyMap<string, Point>
}

export interface DragPlanInput {
  readonly pressedId: string
  /** The current selection. A press on an unselected element drags only that element. */
  readonly selection: ReadonlySet<string>
  /** Membership list for a frame id, or undefined when the id is not a frame. */
  readonly membersOf: (id: string) => readonly string[] | undefined
  readonly positionOf: (id: string) => Point | undefined
}

/**
 * Frames may not contain frames, so expansion is one level deep by construction and this needs
 * no cycle guard. If that ever changes the guard has to come with it.
 */
export function planDrag(input: DragPlanInput): DragPlan {
  const { pressedId, selection, membersOf, positionOf } = input

  // Pressing an unselected element is how a user says "just this one", so the selection is not
  // consulted at all in that case. Pressing a selected one drags the whole selection.
  const roots = selection.has(pressedId) ? [pressedId, ...selection] : [pressedId]

  const ids: string[] = []
  const seen = new Set<string>()
  const origins = new Map<string, Point>()

  const add = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const origin = positionOf(id)
    // A membership list can name an element that no longer exists. The desktop tolerates that
    // rather than failing the gesture, so this does too.
    if (!origin) return
    ids.push(id)
    origins.set(id, origin)
  }

  for (const id of roots) {
    add(id)
    for (const memberId of membersOf(id) ?? []) add(memberId)
  }

  return { ids, origins }
}

/** Where an element in the plan lands for a total canvas-space delta. */
export function positionAt(plan: DragPlan, id: string, dx: number, dy: number): Point | undefined {
  const origin = plan.origins.get(id)
  return origin ? { x: origin.x + dx, y: origin.y + dy } : undefined
}
