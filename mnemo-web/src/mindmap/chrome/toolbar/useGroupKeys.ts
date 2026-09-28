import { useEffect, useRef, type RefObject } from "react"

import { isTyping } from "../../page/route-guards"
import { isPageKey } from "../../page/usePageKeys"
import type { GroupBinding } from "./binding"
import { optionForKey, type ToolbarGroup } from "./groups"

/**
 * The keyboard while a group is open: its option keys pick, Escape closes it, and a group that
 * says so closes behind a pick.
 *
 * Heard on the window's capture phase and stopped there, so a key the group answers never also
 * reaches the map: H on the shape shelf would pick a hexagon and arm the hand. Only keys aimed
 * inside the map pane count, or at the page when nothing has the focus. A menu or dialog keeps its
 * own Escape, and a field or a modifier chord is left alone.
 */
export function useGroupKeys(
  group: ToolbarGroup | null,
  binding: GroupBinding | null,
  onClose: () => void,
  scope: RefObject<HTMLElement | null>,
  suspended: boolean,
): void {
  const live = useRef({ binding, onClose, suspended })
  live.current = { binding, onClose, suspended }

  useEffect(() => {
    if (!group) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        live.current.suspended ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTyping(event.target) ||
        !(scope.current?.contains(event.target as Node) || isPageKey(event))
      ) {
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        live.current.onClose()
        return
      }
      const option = optionForKey(group, event.key)
      if (!option) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      live.current.binding?.pick(option.id)
      if (group.closesOnKey) {
        live.current.onClose()
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [group, scope])
}
