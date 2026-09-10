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
import type { ContentBody } from "./content"

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

/**
 * Which rung a measured size came from.
 *
 * The scene carries the resolved font size, not the scale it came from, because that is what the
 * renderer needs. A control that has to show which of the four is currently on has to go the other
 * way, and going back through the same table is what keeps it honest: it lights the rung the node is
 * actually drawn at, whether that came from the node's own override or from a template rule.
 */
export function fontScaleOf(size: number): FontScale {
  for (const scale of Object.keys(FONTS) as FontScale[]) {
    if (FONTS[scale].size === size) {
      return scale
    }
  }
  return "m"
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

/** Room for the mark a reference leads with, and the gap after it. */
const REF_EXTRA = 20

/** The chip a resolved reference trails, sized so its room can be reserved before it is drawn. */
export const BADGE_SIZE = 9.5
const BADGE_GAP = 10

/**
 * A code body sits in more air than a label does, and stops at eight lines.
 *
 * Eight because a node is a point in an outline, not a file: past that the box stops being something
 * you read at a glance and starts being something you scroll, which a canvas has no way to do.
 */
const CODE_PAD = { x: 8, y: 8 }
const CODE_LINES = 8

export type TextMeasurer = (text: string, size: number, weight: number, letterSpacing?: string) => number

/** A rendered equation's box. Only KaTeX can answer this, and only by rendering it. */
export type MathMeasurer = (latex: string, size: number) => { width: number; height: number }

// The app's own two faces, spelled the way the stylesheet spells them. A measurement taken in a face
// the page does not load is a box sized for text nobody will see: the label still draws in Inter and
// the box around it was built for whatever the system fell back to.
export const FONT_FAMILY = '"Inter", "Segoe UI", Arial, sans-serif'
export const MONO_FAMILY = '"Geist Mono", ui-monospace, "Cascadia Mono", monospace'

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
export function canvasMeasurer(family: string = FONT_FAMILY): TextMeasurer {
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
  return (text, size, weight, letterSpacing) => {
    const key = `${weight}|${size}|${letterSpacing ?? ""}|${text}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      return hit
    }
    // Cleared wholesale rather than evicted one at a time: the working set is one map's labels, and
    // when that changes it changes completely.
    if (cache.size > 4000) {
      cache.clear()
    }
    ctx.font = `${weight} ${size}px ${family}`
    // The label is drawn with the rung's tracking, so a measurement taken without it is a box built
    // for text nobody renders: a hair too wide on every line, and wrong about where one wraps.
    // Older engines have no such attribute and simply keep the untracked width.
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = letterSpacing ?? "0px"
    }
    const width = ctx.measureText(text).width
    cache.set(key, width)
    return width
  }
}

/**
 * How big a rendered equation is.
 *
 * By rendering it. There is no shortcut: the box of `\sum_{i=1}^{n}` has nothing to do with the
 * length of that string, and the layout packs boxes, so a guess here is a tree that overlaps itself
 * around every math node.
 *
 * One detached host, reused and memoized. It is offscreen rather than hidden, because a display of
 * none has no box to read, and it carries the same class the canvas draws math under so the two are
 * measuring and drawing the same thing.
 */
export function katexMeasurer(render: (host: HTMLElement, latex: string) => void): MathMeasurer {
  let host: HTMLElement | null = null
  const cache = new Map<string, { width: number; height: number }>()

  return (latex, size) => {
    const key = `${size}|${latex}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      return hit
    }

    try {
      if (!host) {
        host = document.createElement("div")
        host.className = "mm-math"
        host.setAttribute("aria-hidden", "true")
        host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap"
        document.body.appendChild(host)
      }
      host.style.fontSize = `${size}px`
      render(host, latex)
      const box = { width: Math.ceil(host.offsetWidth), height: Math.ceil(host.offsetHeight) }
      if (cache.size > 500) {
        cache.clear()
      }
      cache.set(key, box)
      return box
    } catch {
      return estimateMath(latex, size)
    }
  }
}

/** Width by character count, for a test with no DOM and for a render that would not run. */
export const estimateMath: MathMeasurer = (latex, size) => ({
  width: Math.ceil(latex.length * size * 0.5),
  height: Math.ceil(size * 1.6),
})

/**
 * Everything a box can need measuring, gathered so the projector passes one thing.
 *
 * Three rather than one because they are three different questions: proportional text wraps,
 * monospace source does not, and an equation is not text at all.
 */
export interface Measurers {
  readonly text: TextMeasurer
  readonly mono: TextMeasurer
  readonly math: MathMeasurer
}

/**
 * A full set from a single text measurer, for the callers that only have one.
 *
 * The thumbnail is the real one: it projects off the main canvas with the estimating measurer, and a
 * thumbnail with a slightly wrong equation box is a thumbnail, where a synchronous KaTeX render per
 * math node per card is a scroll that stutters.
 */
export function measurersFrom(measure: TextMeasurer): Measurers {
  return { text: measure, mono: measure, math: estimateMath }
}

/** The real thing: a canvas per face, and KaTeX for the equations. */
export function domMeasurers(render: (host: HTMLElement, latex: string) => void): Measurers {
  return { text: canvasMeasurer(), mono: canvasMeasurer(MONO_FAMILY), math: katexMeasurer(render) }
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
    width = Math.max(width, measure(value, font.size, font.weight, font.letterSpacing))
  }

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, font.size, font.weight, font.letterSpacing) <= font.maxWidth) {
      line = candidate
      continue
    }

    if (line) {
      push(line)
      line = ""
    }

    if (measure(word, font.size, font.weight, font.letterSpacing) <= font.maxWidth) {
      line = word
      continue
    }

    let chunk = ""
    for (const char of word) {
      if (chunk && measure(chunk + char, font.size, font.weight, font.letterSpacing) > font.maxWidth) {
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
  /** Leaves room for the mark a reference leads with. */
  readonly isRef?: boolean
  /** Room on the right for a chip a reference resolved to, such as a deck's due count. */
  readonly badge?: string
  /** How the box is built. Absent means from a wrapped label, which is what most kinds are. */
  readonly body?: ContentBody
}

export interface MeasuredNode {
  readonly width: number
  readonly height: number
  readonly lines: readonly string[]
  readonly font: Font
  readonly lineHeight: number
  readonly padding: { readonly x: number; readonly y: number }
}

export function measureNode(request: MeasureRequest, measurers: Measurers): MeasuredNode {
  const font = FONTS[request.fontScale] ?? FONTS.m

  if (request.body === "code") {
    return measureCode(request.text, font, measurers.mono)
  }
  if (request.body === "math") {
    return measureMath(request.text, font, measurers.math)
  }

  const padding = request.isRoot ? ROOT_PAD : (PAD[request.shape] ?? PAD.card)
  const lineHeight = Math.round(font.size * LINE_RATIO)

  const wrapped = wrapText(request.text, font, measurers.text)
  const floor = request.text.trim() ? MIN_WIDTH : EMPTY_WIDTH

  let width = Math.max(Math.ceil(wrapped.width) + padding.x * 2, floor)
  if (request.isTask) {
    width += TASK_EXTRA
  }
  if (request.isRef) {
    width += REF_EXTRA
  }
  if (request.badge) {
    width += Math.ceil(measurers.text(request.badge, BADGE_SIZE, 500)) + BADGE_GAP
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

/**
 * A code body: the lines as typed, in monospace, up to the cap.
 *
 * Not wrapped. Indentation is what makes source readable and a wrap loses it, so a line too long for
 * the box is cut off at the edge instead. That is a deliberate difference from every other kind here,
 * and it is the same call the desktop makes.
 */
function measureCode(source: string, font: Font, mono: TextMeasurer): MeasuredNode {
  const all = source.split("\n")
  const lines = all.length > CODE_LINES ? all.slice(0, CODE_LINES) : all
  const lineHeight = Math.round(font.size * LINE_RATIO)

  let widest = 0
  for (const line of lines) {
    widest = Math.max(widest, mono(line, font.size, font.weight))
  }

  return {
    width: Math.max(Math.ceil(Math.min(widest, font.maxWidth)) + CODE_PAD.x * 2, EMPTY_WIDTH),
    height: lines.length * lineHeight + CODE_PAD.y * 2,
    lines,
    font,
    lineHeight,
    padding: CODE_PAD,
  }
}

/** A math body: whatever the equation rendered to, in the same air a card gives its label. */
function measureMath(latex: string, font: Font, math: MathMeasurer): MeasuredNode {
  const padding = PAD.card
  const box = latex.trim() ? math(latex, font.size) : { width: EMPTY_WIDTH - padding.x * 2, height: font.size }

  return {
    width: Math.max(box.width + padding.x * 2, MIN_WIDTH),
    height: box.height + padding.y * 2,
    lines: [latex],
    font,
    lineHeight: box.height,
    padding,
  }
}
