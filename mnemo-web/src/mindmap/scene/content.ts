/**
 * What a content kind costs its box, and what it puts in it.
 *
 * A node is its text for five of the seven kinds. The other two are not: code keeps the line breaks
 * it was typed with and is set in a monospace face, and math is a rendered equation whose size no
 * text measurement can predict. Both of those change how the box is sized, which happens before
 * layout, so the answer has to be available to the projector and not only to the renderer.
 *
 * One module rather than a switch in each, because the projector and the renderer have to agree
 * about which kind draws what. Two switches drift the first time a kind is added to one of them.
 */

import type { ElementContent, FlashcardContent, LinkContent, NoteContent } from "../model/document"
import { contentText } from "../model/document"

/** How a box is built: from a wrapped label, from preformatted source, or from a rendered equation. */
export type ContentBody = "label" | "code" | "math"

export function bodyOf(content: ElementContent): ContentBody {
  switch (content.$type) {
    case "code":
      return "code"
    case "math":
      return "math"
    default:
      return "label"
  }
}

/**
 * The three kinds that point at something else, and the mark each leads with.
 *
 * They share a shape rather than a kind: a leading mark, a title that came from the thing pointed
 * at rather than from typing, and a state where the thing is gone. That is why they are one list
 * here and three cases nowhere.
 *
 * A note and a deck take their own module's mark, so a node pointing at one reads as pointing there
 * rather than at a generic document. A link has no module to borrow from and takes the arrow that
 * means "opens somewhere else" everywhere in the app.
 */
export const REF_GLYPH: Record<string, string> = {
  link: "external-link",
  note: "sidebar/notes",
  flashcard: "sidebar/flashcard",
}

export function refGlyphOf(content: ElementContent): string | null {
  return REF_GLYPH[content.$type] ?? null
}

export function isRef(content: ElementContent): boolean {
  return content.$type in REF_GLYPH
}

/**
 * What a resolved reference turned out to be.
 *
 * A missing entry in the resolution map means the lookup is still out, which is drawn as nothing
 * rather than as a placeholder: a title that flashes in over an em dash is worse than one that
 * simply appears. An entry with `missing` set is the lookup coming back empty, which is a state the
 * map should say out loud, since the node is now pointing at nothing.
 */
export interface RefInfo {
  readonly label: string
  /** A chip the target earned, such as a deck's due count. */
  readonly badge?: string
  readonly missing?: boolean
}

/**
 * The key a reference resolves under, or null for content that points at nothing.
 *
 * Keyed by target rather than by node, so twenty nodes pointing at one deck are one lookup and one
 * cache entry. A link needs none: it carries its own title and its own address.
 */
export function refKey(content: ElementContent): string | null {
  switch (content.$type) {
    case "note":
      return `note:${(content as NoteContent).noteId}`
    case "flashcard":
      return `deck:${(content as FlashcardContent).deckId}`
    default:
      return null
  }
}

/**
 * What a node draws when nothing had to be resolved for it.
 *
 * Almost `contentText`, and deliberately not the same function: that one answers "what does typing
 * into this node edit", which for a link is its title, and this one answers "what does it read as",
 * which for an untitled link is the address itself. A node showing nothing where a URL was pasted
 * looks broken; an editor that pre-fills the URL as the title would quietly make it one.
 */
export function displayText(content: ElementContent): string {
  if (content.$type === "link") {
    const link = content as LinkContent
    return link.title?.trim() ? link.title : (link.url ?? "")
  }
  return contentText(content) ?? ""
}

/**
 * The kinds a node can be converted to, in the order they are offered.
 *
 * Free elements are absent on purpose: a shape or a caption is not in the tree, and converting one
 * into a task would be converting it into something the tree is the only place for.
 */
export const NODE_KINDS = ["text", "task", "code", "math", "link", "note", "flashcard"] as const

export type NodeKind = (typeof NODE_KINDS)[number]

/** The mark each kind is offered under, borrowed from where the app already draws that idea. */
export const KIND_ICON: Record<NodeKind, string> = {
  text: "notes/text",
  task: "notes/todo",
  code: "notes/code",
  math: "notes/equation",
  link: "external-link",
  note: "sidebar/notes",
  flashcard: "sidebar/flashcard",
}

/** The translation key each kind is offered under. */
export const KIND_LABEL: Record<NodeKind, string> = {
  text: "KindText",
  task: "KindTask",
  code: "KindCode",
  math: "KindMath",
  link: "KindLink",
  note: "KindNote",
  flashcard: "KindFlashcard",
}

/** Which of the seven a content is, for lighting the one a node is already on. */
export function nodeKindOf(content: ElementContent): NodeKind | null {
  return (NODE_KINDS as readonly string[]).includes(content.$type) ? (content.$type as NodeKind) : null
}
