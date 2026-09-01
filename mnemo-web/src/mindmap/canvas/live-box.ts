/**
 * The box, following the text while it is being typed.
 *
 * A node is sized by the projector, from the text the document holds. That text does not change
 * until the edit is committed, so without this the box keeps the size the old label had and the new
 * one grows out through it.
 *
 * Measured through the same `measureNode` the projector uses, so the box the typing produces is the
 * box the commit lands on and nothing resettles when the field closes.
 */

import { bodyOf, displayText, isRef } from "../scene/content"
import { fontScaleOf, measureNode, type MeasuredNode } from "../scene/measure"
import { sceneMeasurers } from "../scene/measurers"
import type { SceneElement } from "../model/scene"

/** What a node of this shape and content measures at, for some text in it. */
export function measureFor(element: SceneElement, text: string): MeasuredNode {
  return measureNode(
    {
      text,
      shape: element.nodeShape,
      fontScale: fontScaleOf(element.text.fontSize),
      isRoot: element.isRoot,
      isTask: element.content.$type === "task",
      isCollapsed: element.collapsed === true,
      isRef: isRef(element.content),
      badge: element.refBadge,
      body: bodyOf(element.content),
    },
    sceneMeasurers(),
  )
}

/**
 * Whether this box is the one its own text measures to, which is what says nobody has given it a
 * size by hand.
 *
 * A node dragged to a size of its own keeps it: the projector reads that size in preference to the
 * measured one, so growing it here would show a box the commit then takes back. Only a frame and a
 * picture are sized by something other than their label, and neither opens this field.
 *
 * Asked with the text the projector measured, not the text the field opens on. The two differ for
 * a link with no title, which is drawn as its address and edited as that empty title; measuring the
 * title would answer a different width and quietly switch the live box off for exactly that node.
 */
export function isAutoSized(element: SceneElement): boolean {
  const measured = measureFor(element, displayText(element.content))
  return measured.width === element.width && measured.height === element.height
}
