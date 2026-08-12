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

import { paletteSlotOf } from "./tokens"
import type { SceneElement } from "../model/scene"

/** Just enough of an element to say what colour it came out. */
export interface Accented {
  readonly stroke?: string
  readonly branchColor?: string
}

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
 * Which of the eight this element is drawn in, or null when its colour is not one of them.
 *
 * Null is a real answer: a map can carry a hand-written hex, and a template can turn palette
 * colouring off entirely. A control that guessed a slot would show a hue nothing on screen has.
 */
export function branchSwatchOf(element: SceneElement): number | null {
  return paletteSlotOf(accentOf(element))
}
