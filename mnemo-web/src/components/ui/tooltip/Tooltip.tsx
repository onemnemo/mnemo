import { cloneElement, isValidElement, type ReactElement } from "react"

import type { TooltipSide } from "./placement"

/**
 * A hint on the control it belongs to.
 *
 * It renders nothing of its own: it marks its child, and the single TooltipHost draws
 * whatever the pointer is resting on. That keeps a toolbar from mounting a positioning
 * engine per button, and it means the markup a caller writes is still their own element.
 *
 * A plain `title` already gets the same treatment. Reach for this when the hint needs more
 * than a line of text: a shortcut on a cap, or a side other than above.
 */

export interface TooltipProps {
  /** The line of text. An empty one leaves the child untouched. */
  label: string
  /** A canonical chord ("F", "Primary+Shift+H"), drawn as one cap per key. */
  chord?: string | null
  /** Preferred side. It still flips when there is no room. */
  side?: TooltipSide
  /** A single element that passes props through to a DOM node. */
  children: ReactElement
}

export function Tooltip({ label, chord, side, children }: TooltipProps) {
  if (!label || !isValidElement<Record<string, unknown>>(children)) return children

  const props = children.props
  const patch: Record<string, unknown> = {
    "data-tooltip": label,
    // Otherwise the OS draws its own over ours a moment later.
    title: undefined,
  }
  // Taking `title` away takes the accessible name with it wherever that was all a control
  // had, so put the same words back as a label.
  if (typeof props.title === "string" && props["aria-label"] == null) {
    patch["aria-label"] = props.title
  }
  if (chord) patch["data-tooltip-chord"] = chord
  if (side) patch["data-tooltip-side"] = side

  return cloneElement(children, patch)
}
