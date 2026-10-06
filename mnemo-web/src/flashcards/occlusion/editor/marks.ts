import type { History } from "./history"

/** The selection on either side of one undo step, so undo and redo can show what came back. */
export interface Step {
  before: string[]
  after: string[]
}

/** Steps kept in line with a history's past and future. */
export interface Marks {
  past: Step[]
  future: Step[]
}

export const NO_MARKS: Marks = { past: [], future: [] }

/** Marks after a commit: a new step is added when the history grew, else the last step is extended. */
export function markCommit<T>(marks: Marks, before: History<T>, after: History<T>, selection: { before: string[]; after: string[] }): Marks {
  if (after === before) return marks
  const pushed = after.past.length > 0 && after.past[after.past.length - 1] === before.present
  if (!pushed) {
    if (marks.past.length === 0) return marks
    const last = marks.past[marks.past.length - 1]
    return { past: [...marks.past.slice(0, -1), { before: last.before, after: selection.after }], future: [] }
  }

  const past = [...marks.past, { before: selection.before, after: selection.after }]
  while (past.length > after.past.length) past.shift()
  return { past, future: [] }
}

export function markUndo(marks: Marks): { marks: Marks; step: Step | null } {
  const step = marks.past[marks.past.length - 1] ?? null
  if (!step) return { marks, step }
  return { marks: { past: marks.past.slice(0, -1), future: [step, ...marks.future] }, step }
}

export function markRedo(marks: Marks): { marks: Marks; step: Step | null } {
  const [step, ...future] = marks.future
  if (!step) return { marks, step: null }
  return { marks: { past: [...marks.past, step], future }, step }
}
