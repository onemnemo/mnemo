import { useRef, useState } from "react"

/**
 * State for an inline editor that a menu item can raise, a rename field on a row being
 * the usual one.
 *
 * Two separate things have to be handled or the field never survives the menu closing
 * over it. Radix runs an item's action inside flushSync, while the menu is still open and
 * still trapping focus, so a field mounted straight from there is focused by autoFocus
 * and pulled back into the menu on the same tick, which blurs it and commits it:
 * `openFromMenu` waits a microtask, so the mount lands after the menu has gone. Then the
 * menu hands focus back to whatever opened it, which takes the caret straight back out
 * again: `opensEditor` asks the menu to leave focus alone, but only for the close that
 * follows the editor's own verb, so every other verb and Escape still hand a keyboard
 * user back their place in the page.
 */
export function useInlineEditor(): {
  editing: boolean
  openFromMenu: () => void
  open: () => void
  close: () => void
  opensEditor: () => boolean
} {
  const [editing, setEditing] = useState(false)
  const fromMenu = useRef(false)

  return {
    editing,
    /** Raise the editor from a menu item's action. */
    openFromMenu: () => {
      fromMenu.current = true
      queueMicrotask(() => setEditing(true))
    },
    /** Raise it from anywhere with no menu in the way, a double click say. */
    open: () => setEditing(true),
    close: () => setEditing(false),
    /**
     * For the menu content's `opensDialog`. Answers once and forgets, so it reads the
     * same whether the menu asks before or after the queued mount, and one rename never
     * covers the close after it.
     */
    opensEditor: () => {
      const held = fromMenu.current
      fromMenu.current = false
      return held
    },
  }
}
