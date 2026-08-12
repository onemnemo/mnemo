/**
 * Taking a style off an edge, which the edit protocol has no direct word for.
 *
 * `set_edge` merges a patch member by member and reads a missing member as "leave it alone", so
 * there is no value that means "unset this": null is exactly what a merge ignores. Clearing is
 * therefore expressed as a replacement, `clear_style` plus the members the edge should keep, and
 * this is the arithmetic that works out what those are.
 */

import type { EdgeStyle } from "../model/document"

/**
 * An edge's own overrides after a patch, with a null member dropped rather than stored.
 *
 * Undefined when nothing is left, which is the difference that matters: an edge that names no
 * colour inherits its branch's, and an edge that names an empty style still has a style. Inheriting
 * again is the whole point of a reset.
 */
export function restyledEdge(own: EdgeStyle | null | undefined, patch: EdgeStyle): EdgeStyle | undefined {
  const next: Record<string, unknown> = { ...own }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return Object.keys(next).length > 0 ? (next as EdgeStyle) : undefined
}

/** Whether a patch asks for anything to be taken away, which decides which op can carry it. */
export function clearsAnything(patch: EdgeStyle): boolean {
  return Object.values(patch).some((value) => value === null)
}
