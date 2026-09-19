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

import type { InlineSpan } from "@/notes/model/types"

import { displayText, isRef, runsOf, type ContentBody } from "../scene/content"
import { fontScaleOf, measureNode, type MeasuredNode } from "../scene/measure"
import { sceneMeasurers } from "../scene/measurers"
import type { SceneElement } from "../model/scene"

/**
 * What is in the field right now. `runs` when the field is a formatted editor, in which case `text`
 * is their plain projection; `text` alone when it is a plain field.
 */
export interface LiveLabel {
  readonly text: string
  readonly runs?: readonly InlineSpan[] | null
}

/**
 * How a box is built for what the field holds, which is decided by the field and not by the stored
 * content. A plain node being formatted for the first time is measured as the rendering it is about
 * to commit, and a formatted node in a plain field as the text it is typing.
 */
export function liveBodyOf(element: SceneElement, live: LiveLabel): ContentBody {
  if (element.content.$type === "code") {
    return "code"
  }
  return live.runs ? "rich" : "label"
}

/** What a node of this shape and content measures at, for what is in its field. */
export function measureFor(element: SceneElement, live: LiveLabel): MeasuredNode {
  return measureNode(
    {
      text: live.text,
      shape: element.nodeShape,
      fontScale: fontScaleOf(element.text.fontSize),
      isRoot: element.isRoot,
      isTask: element.content.$type === "task",
      isCollapsed: element.collapsed === true,
      isRef: isRef(element.content),
      badge: element.refBadge,
      body: liveBodyOf(element, live),
      runs: live.runs ?? undefined,
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
 * Asked with the text and the runs the projector measured, not the text the field opens on. The two
 * differ for a link with no title, which is drawn as its address and edited as that empty title;
 * measuring the title would answer a different width and quietly switch the live box off for exactly
 * that node. A formatted label likewise has to be measured as its rendering, or every node with a
 * bold word in it would answer as hand sized.
 */
export function isAutoSized(element: SceneElement): boolean {
  const measured = measureFor(element, { text: displayText(element.content), runs: runsOf(element.content) })
  return measured.width === element.width && measured.height === element.height
}
