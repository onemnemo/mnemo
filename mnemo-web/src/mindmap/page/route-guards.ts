/**
 * Whose keys a press belongs to, before the route decides what it means.
 *
 * Split out from the route component so both guards are checkable against a bare DOM tree, with
 * none of the canvas, stores, or scene the route itself needs to render.
 */

import { SELECT_MODE_ACTIONS, TOOL_ACTIONS } from "../interaction/tool"

/** Keys belong to whatever is being typed into, not to the map behind it. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  return (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT"
  )
}

/**
 * Keys belong to a focused piece of chrome, not to the map behind it.
 *
 * The bars, flyouts, and toolbar are native buttons and menu items floating over the canvas, inside the
 * same div the route reads keydowns from. Without this, Tab never left a focused button (the route
 * treated every Tab as "add a child") and Enter never activated one (the route treated it as "add a
 * sibling"), so a keyboard user who tabbed onto the map's own chrome lost the browser's own Tab/Enter
 * the moment they landed on it.
 */
export function isChromeControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return target.closest('button, a[href], [role="menuitem"], [role="option"], [role="tab"]') !== null
}

/**
 * What a press still means while a control on the toolbar has the focus. A button answers Enter,
 * Space, Tab and the arrows, so letting tool letters through takes nothing from it.
 */
const TOOLBAR_PASSTHROUGH: ReadonlySet<string> = new Set([
  ...Object.values(TOOL_ACTIONS),
  ...Object.values(SELECT_MODE_ACTIONS),
])

/** Whether a press resolved to an action is the map's to answer, given where the focus is. */
export function keyBelongsToMap(target: EventTarget | null, actionId: string): boolean {
  // No control uses F6, and it is the way back from any of them.
  if (!isChromeControl(target) || actionId === "mindmap.focus-toolbar") {
    return true
  }
  return isOnToolbar(target) && TOOLBAR_PASSTHROUGH.has(actionId)
}

/** Inside the toolbar or one of its shelves, which sit beside the bar rather than in it. */
export function isOnToolbar(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-mm-toolbar]") !== null
}

/** Hands the keyboard back to the map, whose canvas is what hears its keys. */
export function focusCanvas(pane: ParentNode | null | undefined): void {
  pane?.querySelector<HTMLElement>("[data-mm-canvas]")?.focus({ preventScroll: true })
}
