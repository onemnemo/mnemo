import type { ElementStyle } from "../model/document"
import { op, type SetOp } from "../model/ops"

/** What "look the same" covers. An icon is what a node is about rather than how it looks, so it stays each node's own. */
const MATCHED = ["fill", "stroke", "textColor", "fontScale", "nodeShape"] as const

/**
 * Gives every other element the primary's stored style, as one batch so it is one undo.
 *
 * Cleared first and rewritten, because a field the primary leaves to its template has to be left to
 * the template on the others too, and a merge cannot take a field away.
 */
export function matchStyleOps(
  primary: ElementStyle | null | undefined,
  others: readonly { id: string; style?: ElementStyle | null }[],
): SetOp[] {
  return others.map(({ id, style }) => {
    const next: ElementStyle = style?.icon != null ? { icon: style.icon } : {}
    for (const key of MATCHED) {
      const value = primary?.[key]
      if (value != null) {
        Object.assign(next, { [key]: value })
      }
    }
    return op.set(id, { clear_style: true, style: next })
  })
}
