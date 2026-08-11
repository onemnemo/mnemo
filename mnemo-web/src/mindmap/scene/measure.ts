/**
 * How big a node is.
 *
 * A mindmap node is its text. It has no fixed width to wrap into and no fixed height to overflow: the
 * box is whatever the words need, and the layout packs the boxes afterwards. So measurement runs
 * before layout, not after it, and it has to be real measurement. A character count times an average
 * width is wrong by enough on "mitochondrion" against "IIIII" to make a packed tree overlap itself.
 *
 * The measurer is injectable for two reasons: a test has no canvas, and the server-side arrange call
 * needs the same numbers this produces, which means they have to be producible without a document.
 */

import type { FontScale, NodeShape } from "../model/document"

export interface Font {
  readonly size: number
  readonly weight: number
  /** Where a line wraps. A ceiling, not a width: a short label stays short. */
  readonly maxWidth: number
  readonly letterSpacing: string
}

/**
 * The four rungs, loudest first. Which rung a node lands on is the cascade's decision, and the built-in
 * templates spend it on depth, so in practice this is the depth ramp with the depth part factored out.
 *
 * Tighter letter spacing at the top only: at 16.5px and above the default tracking reads loose against
 * the surrounding UI, and below it the same correction closes the words up.
 */
export const FONTS: Record<FontScale, Font> = {
  xl: { size: 20, weight: 600, maxWidth: 260, letterSpacing: "-0.016em" },
  l: { size: 16.5, weight: 600, maxWidth: 230, letterSpacing: "-0.014em" },
  m: { size: 14, weight: 500, maxWidth: 190, letterSpacing: "-0.005em" },
  s: { size: 12.5, weight: 450, maxWidth: 165, letterSpacing: "-0.005em" },
}

const LINE_RATIO = 1.35

/**
 * Box padding by shape. `plain` has almost none: the branch runs under the words and the words are
 * the node, so any padding there is a gap between a rule and the text it belongs to.
 */
const PAD: Record<NodeShape, { x: number; y: number }> = {
  plain: { x: 3, y: 2 },
  pill: { x: 10, y: 5 },
  card: { x: 11, y: 7 },
  outline: { x: 11, y: 7 },
}

/** A root is the one node that gets room around it whatever shape it was given. */
const ROOT_PAD = { x: 16, y: 10 }

/** A node with nothing in it yet. Sized so a fresh caret reads as a node and not as a rendering fault. */
const EMPTY_WIDTH = 68
const MIN_WIDTH = 26

/** Room for the checkbox a task draws before its text. */
const TASK_EXTRA = 20

/** Room for the chip saying how much a collapse is hiding. */
const COLLAPSED_EXTRA = 24

export type TextMeasurer = (text: string, size: number, weight: number) => number

const FONT_FAMILY = '"Inter Variable", ui-sans-serif, system-ui, "Segoe UI", sans-serif'

/**
 * Width by character count. The fallback when there is no canvas, and the measurer tests use so a
 * box's expected size is arithmetic rather than whatever the machine running them happens to render.
 */
export const estimateWidth: TextMeasurer = (text, size) => text.length * size * 0.54

/**
 * Real text measurement against a detached canvas, memoized.
 *
 * The cache is the point. A five thousand node map measures five thousand strings on open and then
 * again on every relayout, and the strings barely change between them; without the memo the measuring
 * costs more than the layout it feeds.
 */
export function canvasMeasurer(): TextMeasurer {
  let context: CanvasRenderingContext2D | null = null
  try {
    context = document.createElement("canvas").getContext("2d")
  } catch {
    context = null
  }
  if (!context) {
    return estimateWidth
  }

  const ctx = context
  const cache = new Map<string, number>()
  return (text, size, weight) => {
    const key = `${weight}|${size}|${text}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      return hit
    }
    // Cleared wholesale rather than evicted one at a time: the working set is one map's labels, and
    // when that changes it changes completely.
    if (cache.size > 4000) {
      cache.clear()
    }
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`
    const width = ctx.measureText(text).width
    cache.set(key, width)
    return width
  }
}

export interface WrappedText {
  readonly lines: readonly string[]
  /** The widest line, which is what the box has to hold. */
  readonly width: number
}

/**
 * Greedy word wrap against a ceiling.
 *
 * A single word wider than the ceiling is broken mid-word rather than allowed to overflow, so one long
 * chemical name does not shove an entire branch sideways.
 */
export function wrapText(text: string, font: Font, measure: TextMeasurer): WrappedText {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return { lines: [""], width: 0 }
  }

  const lines: string[] = []
  let line = ""
  let width = 0

  const push = (value: string) => {
    lines.push(value)
    width = Math.max(width, measure(value, font.size, font.weight))
  }

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, font.size, font.weight) <= font.maxWidth) {
      line = candidate
      continue
    }

    if (line) {
      push(line)
      line = ""
    }

    if (measure(word, font.size, font.weight) <= font.maxWidth) {
      line = word
      continue
    }

    let chunk = ""
    for (const char of word) {
      if (chunk && measure(chunk + char, font.size, font.weight) > font.maxWidth) {
        push(chunk)
        chunk = char
      } else {
        chunk += char
      }
    }
    line = chunk
  }

  if (line) {
    push(line)
  }

  return { lines, width }
}

export interface MeasureRequest {
  readonly text: string
  readonly shape: NodeShape
  readonly fontScale: FontScale
  readonly isRoot: boolean
  /** Leaves room for the checkbox. */
  readonly isTask?: boolean
  /** Leaves room for the hidden-count chip. */
  readonly isCollapsed?: boolean
}

export interface MeasuredNode {
  readonly width: number
  readonly height: number
  readonly lines: readonly string[]
  readonly font: Font
  readonly lineHeight: number
  readonly padding: { readonly x: number; readonly y: number }
}

export function measureNode(request: MeasureRequest, measure: TextMeasurer): MeasuredNode {
  const font = FONTS[request.fontScale] ?? FONTS.m
  const padding = request.isRoot ? ROOT_PAD : (PAD[request.shape] ?? PAD.card)
  const lineHeight = Math.round(font.size * LINE_RATIO)

  const wrapped = wrapText(request.text, font, measure)
  const floor = request.text.trim() ? MIN_WIDTH : EMPTY_WIDTH

  let width = Math.max(Math.ceil(wrapped.width) + padding.x * 2, floor)
  if (request.isTask) {
    width += TASK_EXTRA
  }
  if (request.isCollapsed) {
    width += COLLAPSED_EXTRA
  }

  return {
    width,
    height: wrapped.lines.length * lineHeight + padding.y * 2,
    lines: wrapped.lines,
    font,
    lineHeight,
    padding,
  }
}
