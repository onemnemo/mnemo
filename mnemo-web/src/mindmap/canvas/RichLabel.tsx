import { useLayoutEffect, useRef } from "react"

import "@/notes/editor/marks/inline-marks.css"

import { cn } from "@/lib/utils"
import type { InlineSpan } from "@/notes/model/types"

import { runsKey } from "../model/runs"
import type { SceneElement } from "../model/scene"
import { FONTS, fontScaleOf } from "../scene/measure"
import { RICH_BOX_CLASS, richBoxStyle } from "../scene/rich-box"
import { renderRuns } from "./render-runs"

/**
 * A formatted label: the runs, drawn in the box the measurer read them in.
 *
 * Written to the DOM by the run renderer rather than described as JSX, so this is one of the places
 * on the canvas React does not own the subtree. It carries the class list and the metrics the
 * measurer's offscreen host carried, which is what makes the box the layout packed match the box that
 * lands in it: the browser wraps the same DOM at the same points.
 *
 * It sizes to its content and never shrinks to the row it sits in. The measurer read the label on
 * its own, and a flex row a pixel narrower than that would otherwise wrap one word onto a line the
 * box was not built for.
 */
export function RichLabel({
  element,
  runs,
  inset,
}: {
  element: SceneElement
  runs: readonly InlineSpan[]
  /** How far the words come in from the box, on top of the padding: a shape's outline needs room. */
  inset: number
}) {
  const host = useRef<HTMLSpanElement>(null)
  const latest = useRef(runs)
  latest.current = runs
  const key = runsKey(runs)

  useLayoutEffect(() => {
    if (host.current) {
      renderRuns(host.current, latest.current)
    }
  }, [key])

  const { text } = element
  const done = element.content.$type === "task" && (element.content as { done?: boolean }).done === true
  const faded = done || element.refMissing === true
  // The metrics the projector measured with, and the ceiling of the rung they came from.
  const font = {
    size: text.fontSize,
    weight: text.fontWeight,
    letterSpacing: text.letterSpacing,
    maxWidth: FONTS[fontScaleOf(text.fontSize)].maxWidth,
  }

  return (
    <span
      ref={host}
      className={cn(
        RICH_BOX_CLASS,
        "block shrink-0",
        (element.isRoot || element.kind === "shape") && "text-center",
        faded && "text-ink-3",
        done && "line-through",
        element.refMissing && "italic",
      )}
      style={{
        ...richBoxStyle({ font, lineHeight: text.lineHeight }),
        color: faded ? undefined : element.textColor,
        paddingLeft: element.padding.x + inset,
        paddingRight: element.padding.x + inset,
      }}
    />
  )
}
