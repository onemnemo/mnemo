import { isExactlyOneGroup } from "./cards"
import type { EditorAction } from "./keys"
import { NUDGE_BIG_PX, NUDGE_PX, docOf, type Tool } from "./state"
import type { EditorStore } from "./store"

const TOOLS: Partial<Record<EditorAction, Tool>> = {
  "tool-select": "select",
  "tool-pan": "pan",
  "tool-rect": "rect",
  "tool-ellipse": "ellipse",
  "tool-polygon": "polygon",
}

const NUDGES: Partial<Record<EditorAction, [number, number]>> = {
  "nudge-left": [-NUDGE_PX, 0],
  "nudge-right": [NUDGE_PX, 0],
  "nudge-up": [0, -NUDGE_PX],
  "nudge-down": [0, NUDGE_PX],
  "nudge-left-big": [-NUDGE_BIG_PX, 0],
  "nudge-right-big": [NUDGE_BIG_PX, 0],
  "nudge-up-big": [0, -NUDGE_BIG_PX],
  "nudge-down-big": [0, NUDGE_BIG_PX],
}

/**
 * Runs an action. Returns whether it did anything, so a key that means nothing right now (Enter
 * with no polygon, Escape with nothing to cancel) can fall through to the surface around the editor.
 */
export function perform(store: EditorStore, action: EditorAction): boolean {
  const state = store.getState()
  const selected = state.selection.length > 0

  const tool = TOOLS[action]
  if (tool) {
    store.setTool(tool)
    return true
  }
  const nudge = NUDGES[action]
  if (nudge) return store.nudge(nudge[0], nudge[1])

  switch (action) {
    case "finish-polygon":
      return store.finishPolygon()
    case "cancel":
      if (store.cancelGesture() || state.draft) store.cancelDraft()
      else if (state.pending) store.cancelShape()
      else if (state.tool !== "select") store.setTool("select")
      else if (selected) store.clearSelection()
      else return false
      return true
    case "previous-mask":
      store.stepSelection(-1)
      return true
    case "next-mask":
      store.stepSelection(1)
      return true
    case "move-earlier":
      if (selected) store.moveEarlier()
      return selected
    case "move-later":
      if (selected) store.moveLater()
      return selected
    case "rename":
      if (selected) store.env.onRename?.(state.selection[state.selection.length - 1])
      return selected
    case "group":
      store.groupSelection()
      return selected
    case "ungroup":
      store.ungroupSelection()
      return selected
    case "duplicate":
      store.duplicateSelection()
      return selected
    case "select-all":
      store.selectAll()
      return true
    case "delete":
      if (state.pending) return store.removeLastPoint()
      store.deleteSelection()
      return selected
    case "undo":
      store.undo()
      return true
    case "redo":
      store.redo()
      return true
    case "zoom-in":
      store.zoomIn()
      return true
    case "zoom-out":
      store.zoomOut()
      return true
    case "zoom-fit":
      store.fit()
      return true
    case "toggle-masks":
      store.setShowMasks(!state.showMasks)
      return true
    default:
      return false
  }
}

/** Whether Group should read Ungroup: the selection is exactly one group. */
export function selectionIsGroup(store: EditorStore): boolean {
  const state = store.getState()
  return isExactlyOneGroup(docOf(state), state.selection)
}
