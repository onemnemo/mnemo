import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { isEditableTarget } from "@/keybinds/chord"
import { useLocalActions } from "@/keybinds/local"

import { ACTION_NAMESPACE, type EditorAction } from "../keys"
import type { OcclusionEditor } from "../useOcclusionEditor"

/**
 * The editor's keys, read from the keybind catalog so a remap on the Keyboard page applies. Handled
 * on the editor's root rather than the window, which a dialog would keep quiet.
 */
export function useOcclusionKeys(editor: OcclusionEditor): (event: ReactKeyboardEvent) => void {
  const actionFor = useLocalActions(ACTION_NAMESPACE)
  const { perform } = editor

  return useCallback(
    (event) => {
      const native = event.nativeEvent
      // A menu or popover portalled out of the editor still bubbles its keys through React; only
      // the Cards list in its popover is the editor's own.
      const target = native.target as Element
      const own = event.currentTarget.contains(target) || target.closest?.("[data-editor-keys]")
      if (native.defaultPrevented || !own) return
      if (isEditableTarget(native.target)) return
      // A select trigger keeps its typeahead and a tag chip its Delete.
      if (target.closest?.('[role="combobox"], [data-no-editor-keys]')) return

      const hit = actionFor(native)
      if (!hit) return
      const action = hit.actionId.slice(ACTION_NAMESPACE.length + 1) as EditorAction
      if (native.repeat && !action.startsWith("nudge")) return
      // Delete on a footer button or the mode switch means that control, not the masks it is near.
      if (action === "delete" && target.closest?.('button, [role="radio"]') && !target.closest?.("[data-card-row]")) return
      if (perform(action)) event.preventDefault()
    },
    [actionFor, perform],
  )
}
