/**
 * The measurers a real browser projection uses.
 *
 * Split from `measure.ts` so that module stays free of KaTeX and keeps running in a test with no
 * DOM. This is the one place the two are joined, and it is memoized: the canvas measurers each hold
 * a cache worth thousands of strings, and building a second set would throw that away and start over.
 *
 * The equation renderer is the notes editor's, imported rather than reimplemented. That module is
 * the one place KaTeX is called, on purpose, and a mindmap that called it a second way would be a
 * second set of fallback behaviour for invalid LaTeX to disagree about.
 */

import { renderMath } from "@/notes/editor/atoms/katex"

import { domMeasurers, type Measurers } from "./measure"

let cached: Measurers | null = null

export function sceneMeasurers(): Measurers {
  if (!cached) {
    // The source doubles as the accessible label, which is what it is: an offscreen box being
    // measured has nothing to announce, and the on-canvas host wants the LaTeX read out anyway.
    cached = domMeasurers((host, latex) => renderMath(host, latex, latex))
  }
  return cached
}
