/** How many steps back undo can reach. */
export const HISTORY_LIMIT = 100
/** Same-key commits closer together than this fold into one step. */
export const COALESCE_MS = 500

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** The key and time of the last commit, which a following commit may fold into. */
  last: { key: string; at: number } | null
}

export interface CommitOptions<T> {
  /** Commits with the same key in quick succession are one undo step, such as a run of nudges. */
  key?: string
  at?: number
  /** Whether two states are the same. A commit that changes nothing records nothing. */
  equal?: (a: T, b: T) => boolean
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], last: null }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

/** Records `next` as the present. A gesture commits once, when it ends, so a drag is one step. */
export function commit<T>(history: History<T>, next: T, options: CommitOptions<T> = {}): History<T> {
  const { key, at = 0, equal = Object.is } = options
  if (equal(history.present, next)) return history

  const fold = key !== undefined && history.last?.key === key && at - history.last.at < COALESCE_MS && history.past.length > 0
  const last = key === undefined ? null : { key, at }
  if (fold) return { ...history, present: next, future: [], last }

  const past = [...history.past, history.present]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, present: next, future: [], last }
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const past = history.past.slice(0, -1)
  return { past, present: history.past[history.past.length - 1], future: [history.present, ...history.future], last: null }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const [present, ...future] = history.future
  return { past: [...history.past, history.present], present, future, last: null }
}
