/**
 * Folding a server delta into the document already in hand.
 *
 * The alternative is refetching the whole map after every edit, which is what the desktop app does
 * and is the reason a large map there feels heavy: a five-thousand element document is megabytes,
 * and dragging one node should not cost that. A delta is the touched subset, so an edit costs what
 * it changed.
 *
 * The subtlety is ordering. Sibling order is not a field on anything; it is the order of the
 * hierarchy edges in the document's edge array. A delta is a *set* of changed records and cannot
 * express that, so a new sibling folded in naively lands last no matter where the server put it.
 * That is what the `order` companion is for: apply the records, then sort both arrays to the ids the
 * server reported, and the result is the server's document exactly.
 */

import type { ClusterSettings, MindmapDocument, MindmapEdge, MindmapElement } from "./document"

/** The touched subset of a document: what to upsert, and what to drop. */
export interface MindmapRestoreDelta {
  elements?: MindmapElement[]
  edges?: MindmapEdge[]
  clusters?: ClusterSettings[]
  removeElementIds?: string[]
  removeEdgeIds?: string[]
}

/** Element and edge ids in document order. */
export interface MindmapDocumentOrder {
  elements: string[]
  edges: string[]
}

export function isEmptyDelta(delta: MindmapRestoreDelta): boolean {
  return (
    !delta.elements?.length &&
    !delta.edges?.length &&
    !delta.clusters?.length &&
    !delta.removeElementIds?.length &&
    !delta.removeEdgeIds?.length
  )
}

/**
 * Returns a new document with `delta` applied and both arrays put into `order`.
 *
 * Ids in `order` that the document does not have are skipped rather than treated as an error: that
 * only happens when the client and server disagree about the document, and the caller's answer to
 * disagreement is to refetch, not to throw in the middle of a render.
 */
export function applyDelta(
  document: MindmapDocument,
  delta: MindmapRestoreDelta,
  revision: number,
  order?: MindmapDocumentOrder,
): MindmapDocument {
  const elements = upsert(document.elements ?? [], delta.elements ?? [], delta.removeElementIds ?? [])
  const edges = upsert(document.edges ?? [], delta.edges ?? [], delta.removeEdgeIds ?? [])

  // Clusters are keyed by their root rather than an id, and nothing removes them by id: a cluster
  // whose root is gone is dropped when its root element is.
  const clusters = delta.clusters?.length
    ? upsertBy(document.clusters ?? [], delta.clusters, (c) => c.rootId)
    : document.clusters

  return {
    ...document,
    revision,
    elements: order ? sortTo(elements, order.elements) : elements,
    edges: order ? sortTo(edges, order.edges) : edges,
    clusters,
  }
}

function upsert<T extends { id: string }>(current: T[], changed: T[], removed: string[]): T[] {
  if (!changed.length && !removed.length) {
    return current
  }

  const drop = new Set(removed)
  const incoming = new Map(changed.map((item) => [item.id, item]))
  const next: T[] = []

  for (const item of current) {
    if (drop.has(item.id)) {
      continue
    }
    // Replacing in place keeps everything the delta did not touch where it already was, so the
    // sort below only has to move what actually moved.
    const replacement = incoming.get(item.id)
    if (replacement) {
      incoming.delete(item.id)
      next.push(replacement)
    } else {
      next.push(item)
    }
  }

  for (const item of changed) {
    if (incoming.has(item.id)) {
      next.push(item)
    }
  }

  return next
}

function upsertBy<T>(current: T[], changed: T[], key: (item: T) => string): T[] {
  const incoming = new Map(changed.map((item) => [key(item), item]))
  const next = current.map((item) => {
    const replacement = incoming.get(key(item))
    if (!replacement) {
      return item
    }
    incoming.delete(key(item))
    return replacement
  })
  return [...next, ...incoming.values()]
}

/**
 * Reorders `items` to match `ids`. Anything `ids` does not mention keeps its relative position at
 * the end, which is the safest way to be wrong: an unmentioned element still renders.
 */
function sortTo<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (items.length === ids.length && items.every((item, i) => item.id === ids[i])) {
    return items
  }

  const byId = new Map(items.map((item) => [item.id, item]))
  const next: T[] = []

  for (const id of ids) {
    const item = byId.get(id)
    if (item) {
      byId.delete(id)
      next.push(item)
    }
  }

  for (const item of items) {
    if (byId.has(item.id)) {
      next.push(item)
    }
  }

  return next
}
