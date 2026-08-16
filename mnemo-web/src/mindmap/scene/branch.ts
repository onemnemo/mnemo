/**
 * What colour an element came out, and how to read it back.
 *
 * A branch is a position, not a field. Nothing in the document says "this node is on the green
 * branch": the hierarchy walk seeds one branch per depth-1 child and everything below inherits it,
 * and the cascade only falls back to that structural colour when the element has no stroke of its
 * own. So the colour on screen has two possible origins, and telling them apart is this module's job.
 *
 * Reading is done off the resolved scene rather than off the stored overrides, so a control lights
 * the hue that is on screen whether it came from the walk or from somebody choosing one.
 */

import { cssColor, paletteSlotOf } from "./tokens"
import type { SceneElement } from "../model/scene"

/** Just enough of an element to say what colour it came out. */
export interface Accented {
  readonly stroke?: string
  readonly branchColor?: string
}

/** The same, plus the fill, for asking what mark an element makes when it is drawn too small to read. */
export interface Marked extends Accented {
  readonly fill?: string
}

/**
 * What the cascade hands back for an element nobody has coloured: the paper the canvas is made of,
 * and the hairline drawn on it.
 *
 * Built from the tokens rather than written out, so a theme vocabulary that moves cannot leave this
 * list quietly behind.
 */
const PAPER: ReadonlySet<string | undefined> = new Set(
  ["surface", "surfaceAlt", "stroke"].map((token) => cssColor(token)),
)

/** What a mark falls back to when its element carries no colour of its own. */
const MUTED = "var(--ink-3)"

/**
 * The colour an element is drawn in.
 *
 * Its own resolved stroke, which the cascade has already fallen back to the branch's hue for when the
 * element names none of its own. Reading the branch colour first, as this used to, meant a node given
 * a colour of its own went on showing its branch's: the override was stored, and nothing on screen
 * ever changed. That is why colouring one node used to have to be written down a whole branch before
 * anyone could see it.
 */
export function accentOf(element: Accented): string | undefined {
  return element.stroke ?? element.branchColor
}

/**
 * The colour an element makes as a mark, where it is too small to have an inside and an outline.
 *
 * The minimap and the library thumbnail both shrink a map until a node is a few pixels, and both are
 * drawn on paper. An element nobody has coloured resolves to that same paper, which is the honest
 * answer at full size and no answer at all at this one: a paper mark on a paper panel is not faint,
 * it is absent, and an ordinary map showed its coloured roots and nothing else. So a colour somebody
 * chose is kept, and paper becomes the muted ink.
 *
 * The fill is asked first and the accent second, because a branch hue lives on the stroke and never on
 * the fill: reading only the fill would draw a whole rainbow map in one flat grey.
 */
export function markColor(element: Marked): string {
  for (const color of [element.fill, accentOf(element)]) {
    if (color !== undefined && !PAPER.has(color)) {
      return color
    }
  }

  return MUTED
}

/**
 * Which of the eight this element is drawn in, or null when its colour is not one of them.
 *
 * Null is a real answer: a map can carry a hand-written hex, and a template can turn palette
 * colouring off entirely. A control that guessed a slot would show a hue nothing on screen has.
 */
export function branchSwatchOf(element: SceneElement): number | null {
  return paletteSlotOf(accentOf(element))
}
