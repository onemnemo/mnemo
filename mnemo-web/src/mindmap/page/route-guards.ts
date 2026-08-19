/**
 * Whose keys a press belongs to, before the route decides what it means.
 *
 * Split out from the route component so both guards are checkable against a bare DOM tree, with
 * none of the canvas, stores, or scene the route itself needs to render.
 */

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
 * The bars, flyouts, and dock are native buttons and menu items floating over the canvas, inside the
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
