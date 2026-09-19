/**
 * What closing a field on the canvas means for the document.
 *
 * Three fields close through one path: a node label as its runs, a code node's source, a link's
 * title or a frame's heading as plain text. All three can end empty, unchanged, or changed, and
 * the answers differ: an empty label on a node made for this edit takes the node away, an unchanged
 * one costs no revision and no undo step, and a changed one is written in the shape its kind
 * stores. Decided here, pure, so the route only has to apply the answer.
 */

import type { InlineSpan } from "@/notes/model/types"

import { contentText, type ElementContent } from "../model/document"
import { flattenRuns, plainRuns, sameRuns, trimRuns, withRuns } from "../model/runs"
import { runsOf } from "../scene/content"

/** How a field closed: its text, its runs, or abandoned. */
export type FieldResult = { text: string } | { runs: InlineSpan[] } | null

export type LabelCommit =
  | { readonly kind: "none" }
  | { readonly kind: "delete" }
  | { readonly kind: "set"; readonly patch: { t: string } | { content: ElementContent } }

const NONE: LabelCommit = { kind: "none" }
const DELETE: LabelCommit = { kind: "delete" }

/**
 * @param content the element's content as it stands, or undefined when the element is gone.
 * @param wasBlank the element was made for this edit and never had a label.
 */
export function labelCommit(
  content: ElementContent | undefined,
  wasBlank: boolean,
  result: FieldResult,
): LabelCommit {
  if (result === null) {
    return NONE
  }
  if ("runs" in result) {
    return runsCommit(content, wasBlank, trimRuns(result.runs))
  }
  return textCommit(content, wasBlank, result.text.trim())
}

function textCommit(content: ElementContent | undefined, wasBlank: boolean, typed: string): LabelCommit {
  if (typed === "") {
    // A node created for this edit and never given a label is a box nobody asked for. One that
    // already had a label keeps it, because emptying a node is what Delete is for.
    return wasBlank ? DELETE : NONE
  }
  // The same slot `t` writes back into: a code node's source, a link's title, a frame's heading.
  if (content && typed === (contentText(content) ?? "")) {
    return NONE
  }
  return { kind: "set", patch: { t: typed } }
}

function runsCommit(content: ElementContent | undefined, wasBlank: boolean, runs: InlineSpan[]): LabelCommit {
  const text = flattenRuns(runs)
  if (text.trim() === "") {
    return wasBlank ? DELETE : NONE
  }
  if (content && sameRuns(runs, runsOf(content) ?? plainRuns(contentText(content) ?? ""))) {
    return NONE
  }
  const next = content ? withRuns(content, runs) : null
  return { kind: "set", patch: next ? { content: next } : { t: text.trim() } }
}
