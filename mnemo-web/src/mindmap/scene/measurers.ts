/**
 * The measurers a real browser projection uses.
 *
 * Split from `measure.ts` so that module stays free of KaTeX and keeps running in a test with no
 * DOM. This is the one place the two are joined, and it is memoized for each font epoch: the canvas
 * measurers keep their caches while the active faces stay the same, then get a new identity so the
 * scene projector cannot reuse boxes measured with an earlier face.
 *
 * The equation renderer is the notes editor's, imported rather than reimplemented. That module is
 * the one place KaTeX is called, on purpose, and a mindmap that called it a second way would be a
 * second set of fallback behaviour for invalid LaTeX to disagree about.
 */

import { renderMath } from "@/notes/editor/atoms/katex"

import { fontEpoch } from "./fonts"
import { domMeasurers, type Measurers } from "./measure"

let cached: { epoch: number; measurers: Measurers } | null = null

export function sceneMeasurers(epoch = fontEpoch.current()): Measurers {
  if (cached?.epoch !== epoch) {
    // The source doubles as the accessible label, which is what it is: an offscreen box being
    // measured has nothing to announce, and the on-canvas host wants the LaTeX read out anyway.
    cached = { epoch, measurers: domMeasurers((host, latex) => renderMath(host, latex, latex)) }
  }
  return cached.measurers
}
