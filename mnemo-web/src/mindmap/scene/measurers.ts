/**
 * The measurers a real browser projection uses.
 *
 * Split from `measure.ts` so that module stays free of KaTeX and keeps running in a test with no
 * DOM. This is the one place the two are joined, and it is memoized for each font epoch: the canvas
 * measurers keep their caches while the active faces stay the same, then get a new identity so the
 * scene projector cannot reuse boxes measured with an earlier face.
 *
 * The run renderer is the canvas label's own, imported rather than reimplemented. A formatted label
 * is measured by laying its runs out and reading the box, and that box is the box the label lands in
 * only if the two are the same DOM.
 */

import { renderRuns } from "../canvas/render-runs"
import { fontEpoch } from "./fonts"
import { domMeasurers, type Measurers } from "./measure"

let cached: { epoch: number; measurers: Measurers } | null = null

export function sceneMeasurers(epoch = fontEpoch.current()): Measurers {
  if (cached?.epoch !== epoch) {
    cached = { epoch, measurers: domMeasurers(renderRuns) }
  }
  return cached.measurers
}
