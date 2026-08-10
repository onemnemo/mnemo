/**
 * Undo and redo, as a stack of server-computed deltas.
 *
 * Not document snapshots: a five-thousand element map times a hundred history entries is a number
 * nobody should hold in memory, and a snapshot restores state the server may since have moved past.
 * A delta names only the ids the edit touched, and replaying it is the same revision-checked write
 * as any other edit, so a stale one is refused rather than silently reverting someone else's work.
 *
 * The stack is a plain data structure on purpose. It has no React in it and no network in it: the
 * caller performs the restore and reports whether it landed, which is what lets an entry stay on the
 * stack when a restore is refused instead of being lost to a failed round trip.
 */

import { isEmptyDelta, type MindmapRestoreDelta } from "./delta"

/** One reversible step: the delta that undoes it, and the delta that redoes it. */
export interface HistoryEntry {
  undo: MindmapRestoreDelta
  redo: MindmapRestoreDelta
  /** What the step was, for the "Undo rename" label on the button. */
  label: string
  /**
   * Consecutive steps sharing a key fold into one entry, so a word typed into a node is one undo
   * rather than one per keystroke. Null never folds.
   */
  coalesceKey?: string | null
}

export interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

/** Deep enough to cover a working session, shallow enough that the deltas cannot pile up. */
const LIMIT = 120

export function emptyHistory(): HistoryState {
  return { past: [], future: [] }
}

/**
 * Records a completed edit.
 *
 * A step that changes nothing is dropped rather than pushed, so a click that reselects the same
 * value does not cost an undo press. Folding merges into the entry already on top: its `redo` grows
 * to include the new change, its `undo` stays the one that reaches back to before the group started.
 */
export function record(state: HistoryState, entry: HistoryEntry): HistoryState {
  if (isEmptyDelta(entry.undo) && isEmptyDelta(entry.redo)) {
    return state
  }

  const top = state.past[state.past.length - 1]
  const folds =
    entry.coalesceKey != null && top !== undefined && top.coalesceKey === entry.coalesceKey

  if (folds) {
    const merged: HistoryEntry = {
      // Reaching back past the whole group is the point of folding, so the group's original undo
      // is the one that survives.
      undo: mergeDeltas(entry.undo, top.undo),
      redo: mergeDeltas(top.redo, entry.redo),
      label: entry.label,
      coalesceKey: entry.coalesceKey,
    }
    return { past: [...state.past.slice(0, -1), merged], future: [] }
  }

  // A new edit invalidates the redo branch: there is no longer a future to return to.
  return { past: [...state.past, entry].slice(-LIMIT), future: [] }
}

/**
 * Hands back the entry to replay for an undo, and the state to adopt if the replay lands.
 * Null when there is nothing to undo.
 */
export function undo(state: HistoryState): { entry: HistoryEntry; next: HistoryState } | null {
  const entry = state.past[state.past.length - 1]
  if (!entry) {
    return null
  }
  return {
    entry,
    next: { past: state.past.slice(0, -1), future: [...state.future, entry] },
  }
}

export function redo(state: HistoryState): { entry: HistoryEntry; next: HistoryState } | null {
  const entry = state.future[state.future.length - 1]
  if (!entry) {
    return null
  }
  return {
    entry,
    next: { past: [...state.past, entry], future: state.future.slice(0, -1) },
  }
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0
}

export function undoLabel(state: HistoryState): string | undefined {
  return state.past[state.past.length - 1]?.label
}

export function redoLabel(state: HistoryState): string | undefined {
  return state.future[state.future.length - 1]?.label
}

/**
 * Combines two deltas into one that has the effect of applying `first` then `second`.
 *
 * Both are sets keyed by id, so `second` wins wherever they overlap, and an id `second` removes is
 * dropped from `first`'s upserts entirely rather than being restored and then removed again.
 */
export function mergeDeltas(first: MindmapRestoreDelta, second: MindmapRestoreDelta): MindmapRestoreDelta {
  const removedElements = new Set(second.removeElementIds ?? [])
  const removedEdges = new Set(second.removeEdgeIds ?? [])

  return {
    elements: mergeById(first.elements ?? [], second.elements ?? [], removedElements),
    edges: mergeById(first.edges ?? [], second.edges ?? [], removedEdges),
    clusters: mergeBy(first.clusters ?? [], second.clusters ?? [], (c) => c.rootId),
    removeElementIds: union(first.removeElementIds, second.removeElementIds),
    removeEdgeIds: union(first.removeEdgeIds, second.removeEdgeIds),
  }
}

function mergeById<T extends { id: string }>(first: T[], second: T[], removed: Set<string>): T[] {
  const merged = new Map<string, T>()
  for (const item of first) {
    if (!removed.has(item.id)) {
      merged.set(item.id, item)
    }
  }
  for (const item of second) {
    merged.set(item.id, item)
  }
  return [...merged.values()]
}

function mergeBy<T>(first: T[], second: T[], key: (item: T) => string): T[] {
  const merged = new Map<string, T>()
  for (const item of [...first, ...second]) {
    merged.set(key(item), item)
  }
  return [...merged.values()]
}

function union(first: string[] | undefined, second: string[] | undefined): string[] {
  if (!first?.length) {
    return second ?? []
  }
  if (!second?.length) {
    return first
  }
  return [...new Set([...first, ...second])]
}
