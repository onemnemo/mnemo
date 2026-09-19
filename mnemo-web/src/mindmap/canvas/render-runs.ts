/**
 * A run list, written into a host as the DOM the notes editor draws the same runs as.
 *
 * The marks nest in the order the notes schema ranks them, outermost first, so a run that is bold and
 * a link is `strong > a` here as it is in a note, and the mark stylesheet the two share lands on the
 * same tree. An equation and a fraction are the atoms the notes views draw, filled by the same KaTeX
 * call, so a map and a note typeset one formula identically.
 *
 * Display only. A link is an anchor so the link rule colours it, but nothing here follows one: the
 * canvas owns every press on a node. An address that fails the notes safety rule gets no `href` at
 * all, which is the same gate the notes link mark renders through.
 *
 * Framework free on purpose. The measurer renders runs into an offscreen host to read their box and
 * the label renders them onto the canvas, and the box read is the box drawn only if both go through
 * one function.
 */

import { renderMath } from "@/notes/editor/atoms/katex"
import { isSafeUrl } from "@/notes/editor/schema/safe-url"
import type { InlineSpan, TextStyle } from "@/notes/model/types"

export function renderRuns(host: HTMLElement, runs: readonly InlineSpan[]): void {
  host.replaceChildren()
  for (const run of runs) {
    host.appendChild(wrapMarks(leafOf(run), run.style))
  }
}

/** The run's own content before any mark wraps it. A break inside text stays a character. */
function leafOf(run: InlineSpan): Node {
  switch (run.kind) {
    case "text":
      return document.createTextNode(run.text)
    case "equation": {
      const atom = document.createElement("span")
      atom.className = "notes-atom notes-equation"
      renderMath(atom, run.latex, run.latex)
      return atom
    }
    case "fraction": {
      const atom = document.createElement("span")
      atom.className = "notes-atom notes-fraction"
      // A denominator at or below zero has no rendering; the notes view clamps it the same way.
      const numerator = Number(run.numerator) || 0
      const denominator = run.denominator > 0 ? run.denominator : 1
      renderMath(atom, `\\frac{${String(numerator)}}{${String(denominator)}}`, `${String(numerator)}/${String(denominator)}`)
      return atom
    }
  }
}

/**
 * Innermost first, so the last wrapper applied is the outermost element and the tree reads in the
 * schema's rank order from the outside in.
 */
function wrapMarks(leaf: Node, style: TextStyle): Node {
  let node = leaf
  if (style.linkUrl) {
    const anchor = document.createElement("a")
    if (isSafeUrl(style.linkUrl)) {
      anchor.setAttribute("href", style.linkUrl)
    }
    anchor.setAttribute("rel", "noopener noreferrer")
    // An anchor is natively draggable, and a press on a linked word has to start the node's drag,
    // not a drag of its address.
    anchor.setAttribute("draggable", "false")
    node = wrap(anchor, node)
  }
  if (style.foregroundColor) {
    node = wrap(swatch("data-fg-swatch", style.foregroundColor), node)
  }
  if (style.backgroundColor) {
    node = wrap(swatch("data-bg-swatch", style.backgroundColor), node)
  }
  if (style.highlight) {
    node = wrap(document.createElement("mark"), node)
  }
  if (style.code) {
    node = wrap(document.createElement("code"), node)
  }
  if (style.strikethrough) {
    node = wrap(document.createElement("s"), node)
  }
  if (style.underline) {
    node = wrap(document.createElement("u"), node)
  }
  if (style.superscript) {
    node = wrap(document.createElement("sup"), node)
  }
  if (style.subscript) {
    node = wrap(document.createElement("sub"), node)
  }
  if (style.italic) {
    node = wrap(document.createElement("em"), node)
  }
  if (style.bold) {
    node = wrap(document.createElement("strong"), node)
  }
  return node
}

function swatch(attribute: string, token: string): HTMLElement {
  const span = document.createElement("span")
  span.setAttribute(attribute, token)
  return span
}

function wrap(outer: HTMLElement, inner: Node): HTMLElement {
  outer.appendChild(inner)
  return outer
}
