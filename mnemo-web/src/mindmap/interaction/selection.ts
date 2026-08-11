/**
 * What is selected, as a value.
 *
 * Elements and edges are kept in separate sets rather than in one bag of ids, because almost
 * everything that reads a selection wants one or the other: the drag planner moves elements, the
 * edge bar styles edges, and a set that mixes them makes every reader filter first. They share a
 * primary, because there is only ever one thing a contextual bar can take its current values from.
 *
 * Pure, so the interesting cases (toggling the primary off, replacing a selection that already
 * holds the pressed element) are unit tests rather than things to click through.
 */

export type SelectionKind = "element" | "edge"

export interface SelectionRef {
  readonly kind: SelectionKind
  readonly id: string
}

export interface Selection {
  readonly elements: ReadonlySet<string>
  readonly edges: ReadonlySet<string>
  /** The one a contextual bar reads. Null when nothing is selected. */
  readonly primary: SelectionRef | null
}

const NO_IDS: ReadonlySet<string> = new Set()

export const EMPTY_SELECTION: Selection = { elements: NO_IDS, edges: NO_IDS, primary: null }

export function isEmpty(selection: Selection): boolean {
  return selection.elements.size === 0 && selection.edges.size === 0
}

export function selectionSize(selection: Selection): number {
  return selection.elements.size + selection.edges.size
}

export function isSelected(selection: Selection, kind: SelectionKind, id: string): boolean {
  return setFor(selection, kind).has(id)
}

/** Everything else drops away. What a plain click does. */
export function selectOnly(kind: SelectionKind, id: string): Selection {
  const ids: ReadonlySet<string> = new Set([id])
  return kind === "element"
    ? { elements: ids, edges: NO_IDS, primary: { kind, id } }
    : { elements: NO_IDS, edges: ids, primary: { kind, id } }
}

/** What a marquee release commits, and what select-all builds. */
export function selectElements(ids: Iterable<string>): Selection {
  const elements = new Set(ids)
  return { elements, edges: NO_IDS, primary: lastOf(elements, "element") }
}

/**
 * Adds when absent, removes when present. The primary follows the addition, so shift-clicking a
 * second node points the bar at the one just clicked rather than at the one before it.
 */
export function toggle(selection: Selection, kind: SelectionKind, id: string): Selection {
  const next = new Set(setFor(selection, kind))
  const removing = next.delete(id)
  if (!removing) {
    next.add(id)
  }

  const merged: Selection =
    kind === "element"
      ? { elements: next, edges: selection.edges, primary: selection.primary }
      : { elements: selection.elements, edges: next, primary: selection.primary }

  if (!removing) {
    return { ...merged, primary: { kind, id } }
  }
  // Removing the primary leaves the bar pointing at something that is no longer selected, so it
  // falls back to whatever is still there rather than to nothing.
  return merged.primary?.id === id && merged.primary.kind === kind
    ? { ...merged, primary: fallbackPrimary(merged) }
    : merged
}

/** Union, for a shift-dragged marquee. Elements only: a marquee cannot sweep up an edge. */
export function addElements(selection: Selection, ids: Iterable<string>): Selection {
  const elements = new Set(selection.elements)
  let last: string | null = null
  for (const id of ids) {
    elements.add(id)
    last = id
  }
  return {
    elements,
    edges: selection.edges,
    primary: last ? { kind: "element", id: last } : selection.primary,
  }
}

/** Drops ids that are no longer in the document, after a delete or a reload. */
export function retain(
  selection: Selection,
  hasElement: (id: string) => boolean,
  hasEdge: (id: string) => boolean,
): Selection {
  const elements = filterSet(selection.elements, hasElement)
  const edges = filterSet(selection.edges, hasEdge)
  if (elements === selection.elements && edges === selection.edges) {
    return selection
  }

  const kept: Selection = { elements, edges, primary: selection.primary }
  const primaryLives =
    selection.primary != null && setFor(kept, selection.primary.kind).has(selection.primary.id)
  return primaryLives ? kept : { ...kept, primary: fallbackPrimary(kept) }
}

function setFor(selection: Selection, kind: SelectionKind): ReadonlySet<string> {
  return kind === "element" ? selection.elements : selection.edges
}

function fallbackPrimary(selection: Selection): SelectionRef | null {
  return lastOf(selection.elements, "element") ?? lastOf(selection.edges, "edge")
}

function lastOf(ids: ReadonlySet<string>, kind: SelectionKind): SelectionRef | null {
  let last: string | null = null
  for (const id of ids) {
    last = id
  }
  return last === null ? null : { kind, id: last }
}

function filterSet(ids: ReadonlySet<string>, keep: (id: string) => boolean): ReadonlySet<string> {
  let dropped = false
  const next = new Set<string>()
  for (const id of ids) {
    if (keep(id)) {
      next.add(id)
    } else {
      dropped = true
    }
  }
  return dropped ? next : ids
}
