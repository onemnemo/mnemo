/**
 * Style tokens to CSS.
 *
 * A document stores token names, never colours: `accent`, `surface`, `palette.3`. That is what lets a
 * map authored in the light theme look native in the dark one without touching a single element. The
 * names are the desktop's (`Mnemo.Core/Models/Mindmap/MindmapStyleTokens.cs`); the variables are this
 * app's, so this file is the one place the two vocabularies meet.
 *
 * Everything resolves to a `var()` rather than a computed colour, so flipping the theme repaints the
 * canvas without React knowing anything happened.
 */

/** Entries in each theme's branch ramp, matching the desktop's palette size. */
export const BRANCH_COUNT = 8

const TOKEN_VARS: Record<string, string> = {
  accent: "--accent",
  onAccent: "--accent-fg",
  surface: "--canvas",
  surfaceAlt: "--canvas-sunken",
  textPrimary: "--ink",
  textMuted: "--ink-2",
  stroke: "--line",
}

const PALETTE_TOKEN = /^palette\.([1-8])$/

/**
 * Colour syntax we hand through untouched. A document is supposed to store tokens, but the model
 * permits a raw literal and a user template written by hand will contain one.
 */
const LITERAL_PREFIX = /^(#|rgb|hsl|oklch|oklab|lab|lch|color-mix|var\()/

/** Wraps an index into the ramp. Double modulo so a negative index lands somewhere real. */
export function branchSlot(index: number): number {
  return (((index % BRANCH_COUNT) + BRANCH_COUNT) % BRANCH_COUNT) + 1
}

/** The token name for a branch slot, in the form the document and the desktop both store. */
export function branchToken(index: number): string {
  return `palette.${branchSlot(index)}`
}

/** The branch's own colour. */
export function branchColor(index: number): string {
  return `var(--branch-${branchSlot(index)})`
}

/**
 * The branch's colour pulled far enough back to sit behind text. A pill in full chroma turns a map
 * into a bag of sweets, so the wash is authored per hue in the theme rather than derived here.
 */
export function branchWash(index: number): string {
  return `var(--branch-${branchSlot(index)}-wash)`
}

/** A palette hue resolves to this, so this is how one is recognised again. */
const PALETTE_VAR = /^var\(--branch-([1-8])\)$/

/**
 * Which of the eight a resolved colour is, or null when it is not one of them.
 *
 * Null is a real answer rather than a failure: a map can carry a hand-written hex, and a template can
 * turn palette colouring off entirely.
 */
export function paletteSlotOf(color: string | null | undefined): number | null {
  const found = color ? PALETTE_VAR.exec(color) : null
  return found ? Number(found[1]) : null
}

/**
 * The wash that goes with a resolved colour, or null when the colour is not a palette hue.
 *
 * Taken from the colour rather than from the element's branch, so a node given a hue of its own is
 * washed in that hue instead of in the one its position would have given it.
 */
export function washOf(color: string | null | undefined): string | null {
  const slot = paletteSlotOf(color)
  return slot === null ? null : `var(--branch-${slot}-wash)`
}

/**
 * A colour at partial strength.
 *
 * `color-mix` rather than an alpha suffix because the colour is a `var()`: appending `33` to
 * `var(--branch-3)` produces a string CSS silently discards, and the element renders with no ring at
 * all rather than with a wrong one.
 */
export function mixColor(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}

/**
 * A token as CSS, or undefined when the name means nothing here.
 *
 * Undefined rather than a guessed fallback: the caller knows what this colour is for and has a better
 * default than this function does, and emitting an invalid value would take the whole style attribute
 * down with it rather than just this one property.
 */
export function cssColor(token: string | null | undefined): string | undefined {
  if (!token) {
    return undefined
  }

  const variable = TOKEN_VARS[token]
  if (variable) {
    return `var(${variable})`
  }

  const palette = PALETTE_TOKEN.exec(token)
  if (palette) {
    return `var(--branch-${palette[1]})`
  }

  return LITERAL_PREFIX.test(token) ? token : undefined
}
