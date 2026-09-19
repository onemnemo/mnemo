/**
 * The box a formatted label is laid out in, defined once.
 *
 * A rich label is measured by rendering its runs into an offscreen host and reading the box, and
 * drawn by rendering the same runs into a span on the canvas. The two agree only if they are the same
 * DOM: the same class list, so the same mark rules reach them, and the same metrics, so the browser
 * wraps them at the same points. Both take their class and their style from here rather than each
 * spelling its own copy.
 *
 * The box has a ceiling and no width. Every browser sizes a box with no width to its content, so a
 * short label stays as short as its words and only a long one reaches the ceiling and wraps there. A
 * fixed width would report the ceiling for every node.
 */

import type { Font } from "./measure"

/** The label class the scene index looks for, the rich marker, and the scope the mark rules use. */
export const RICH_BOX_CLASS = "mm-label mm-rich inline-marks"

export interface RichBoxMetrics {
  readonly font: Font
  readonly lineHeight: number
}

/**
 * The inline style both boxes carry, as React spells it. Every value is a string so it can also be
 * assigned straight onto a DOM element's style.
 *
 * Content-box sizing so the ceiling is the width the words wrap at, whatever padding the box on the
 * canvas adds around them; pre-wrap so a break inside a run is a break and a run of spaces is kept.
 */
export function richBoxStyle({ font, lineHeight }: RichBoxMetrics): Record<string, string> {
  return {
    boxSizing: "content-box",
    maxWidth: `${font.maxWidth}px`,
    whiteSpace: "pre-wrap",
    fontSize: `${font.size}px`,
    fontWeight: String(font.weight),
    lineHeight: `${lineHeight}px`,
    letterSpacing: font.letterSpacing,
  }
}
