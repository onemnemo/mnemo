import type { MouseEvent } from "react"

/**
 * True when a click belongs to the corner actions and so is not a reveal. It reads the event path
 * because the target is often an SVG icon, or detached by a re-render.
 */
export function isCardActionClick(event: MouseEvent): boolean {
  return event.nativeEvent
    .composedPath()
    .some((node) => node instanceof Element && (node.tagName === "BUTTON" || node.hasAttribute("data-card-actions")))
}
