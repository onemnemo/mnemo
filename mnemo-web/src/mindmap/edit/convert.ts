/**
 * Turning a node into a different kind of node.
 *
 * A conversion carries the words across, because on the canvas the words are the node: someone who
 * types a line and then makes it a task meant to keep the line. What "the words" are differs by
 * kind, and for the two reference kinds they are not stored on the node at all, so the resolution
 * map is part of the question rather than a detail of drawing.
 *
 * Three kinds cannot be reached from the text alone. A link needs an address, and a note or deck
 * reference needs something to point at. None of those can be inferred from a label, so the caller
 * goes and asks; the four that can are the ones this module builds outright.
 */

import type { ElementContent, LinkContent } from "../model/document"
import { displayText, refKey, type NodeKind, type RefInfo } from "../scene/content"

/** The kinds a node can become from its own text, with nothing else asked for. */
export type PlainKind = "text" | "task" | "code" | "math"

const PLAIN: ReadonlySet<string> = new Set<PlainKind>(["text", "task", "code", "math"])

export function isPlainKind(kind: NodeKind): kind is PlainKind {
  return PLAIN.has(kind)
}

/**
 * The words a conversion carries out of this node.
 *
 * A reference reads as its target's title, which is not stored on the node, so it comes from the
 * same resolution map the projector laid the node out with. An unresolved or broken one carries
 * nothing, which is the honest answer: no title is known, and the placeholder standing in for one
 * is a message about the map rather than something anybody typed.
 */
export function carriedText(content: ElementContent, refs: ReadonlyMap<string, RefInfo>): string {
  const key = refKey(content)
  if (key) {
    const info = refs.get(key)
    return info && !info.missing ? info.label : ""
  }
  return displayText(content)
}

/** What the node becomes, for the kinds that need nothing but its words. */
export function plainContent(kind: PlainKind, text: string): ElementContent {
  switch (kind) {
    case "task":
      return { $type: "task", text }
    case "code":
      return { $type: "code", source: text }
    case "math":
      return { $type: "math", latex: text }
    default:
      return { $type: "text", text }
  }
}

/**
 * A link to this address, labelled with whatever the node was already saying.
 *
 * A title that repeats the address is not a title, and storing one would leave a node that looks
 * titled and reads the same either way. Dropping it keeps the display rule honest, which is that a
 * link with no title of its own shows its address.
 */
export function linkContent(url: string, text: string): LinkContent {
  const title = text.trim()
  return title && title !== url ? { $type: "link", url, title } : { $type: "link", url }
}
