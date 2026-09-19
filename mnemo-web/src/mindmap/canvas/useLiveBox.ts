/**
 * The box, following what is typed into it.
 *
 * A node is sized by the projector, from the label the document holds. That label does not change
 * until the edit is committed, so without this the box keeps the size the old label had and the new
 * one grows out through it.
 */

import { useCallback, useEffect, useRef } from "react"

import type { SceneElement } from "../model/scene"
import type { ElementBox } from "./edge-paths"
import { isAutoSized, liveBodyOf, measureFor, type LiveLabel } from "./live-box"

/** The field grows with what is typed, since the box itself is only remeasured on commit. */
function grow(node: HTMLTextAreaElement): void {
  node.style.height = "0px"
  node.style.height = `${node.scrollHeight}px`
}

/** Tells the box what the field now holds, the words and any runs, so it can follow. */
export type LiveResize = (field: HTMLElement, live: LiveLabel) => void

/**
 * Keeps the node's box the size of what is being typed into it.
 *
 * Written to the host directly rather than held as state, for the reason the field itself is
 * uncontrolled: a keystroke that re-renders the canvas subtree costs more than the box is worth.
 *
 * Only for a box that is still the size its own text measures to. One given a size by hand keeps
 * it, because the projector prefers that size and growing it here would be undone by the commit.
 */
export function useLiveBox(element: SceneElement, onResize?: (id: string, box: ElementBox) => void): LiveResize {
  const host = useRef<HTMLElement | null>(null)
  const auto = useRef(false)
  const last = useRef<{ width: number; height: number } | null>(null)
  const opened = useRef(element)
  opened.current = element
  const report = useRef(onResize)
  report.current = onResize

  useEffect(() => {
    const box = host.current
    return () => {
      // Escape leaves the document untouched, so nothing re-renders this node and the size typing
      // wrote would otherwise stay on a box whose label went back to what it was. The branches are
      // told as well, for the same reason they are told while it grows.
      if (box && auto.current) {
        const { id, x, y, width, height } = opened.current
        box.style.width = `${width}px`
        box.style.height = `${height}px`
        report.current?.(id, { x, y, width, height })
      }
    }
  }, [])

  return useCallback((field: HTMLElement, live: LiveLabel) => {
    if (!host.current) {
      host.current = field.closest<HTMLElement>(".mm-node")
      auto.current = isAutoSized(opened.current)
    }
    const box = host.current
    if (!box || !auto.current) {
      // A box that cannot grow leaves the field the only thing that can.
      if (field instanceof HTMLTextAreaElement) {
        grow(field)
      }
      return
    }

    // Width first, and from the projector, so the field re-wraps at the width the box is keeping.
    const measured = measureFor(opened.current, live)
    box.style.width = `${measured.width}px`

    // Only then the height, and for a plain label from the field itself. Read before the width
    // lands it answers for the width the box had a keystroke ago, which is a line count that
    // disagrees with what is on screen. Taken from the field rather than from the measurement so the
    // box holds the text even where the two wrap differently. Source is drawn capped at its eight
    // lines and a formatted label is measured as the very rendering it will commit as, so for those
    // the measurement is the height the commit lands on and the field is free to run past it.
    if (field instanceof HTMLTextAreaElement) {
      grow(field)
    }
    const height =
      liveBodyOf(opened.current, live) === "label"
        ? field.scrollHeight + opened.current.padding.y * 2
        : measured.height
    box.style.height = `${height}px`

    // Once a label has wrapped, most keystrokes land on the width it is clamped to and the line
    // count it already had, and the branches only need telling when the box actually moved.
    if (last.current?.width === measured.width && last.current?.height === height) {
      return
    }
    last.current = { width: measured.width, height }

    report.current?.(opened.current.id, {
      x: opened.current.x,
      y: opened.current.y,
      width: measured.width,
      height,
    })
  }, [])
}
