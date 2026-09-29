/**
 * What a press on the canvas means.
 *
 * Panning stays available inside every tool, on the middle button, alt-drag and held space. The
 * hand tool is the same pan on the primary button, for a trackpad or pen with no middle button.
 */

export type MindmapTool = "select" | "pan" | "node" | "shape" | "text" | "connect" | "frame" | "image"

/** How the select tool sweeps empty canvas: a rectangle, or a free-hand loop. */
export type SelectMode = "box" | "lasso"

/**
 * The action that arms each tool.
 *
 * Which key that is belongs to the keybind catalog, not here, so the toolbar shows whatever someone
 * has bound and a rebind moves the letter on the tooltip along with the key that works.
 */
export const TOOL_ACTIONS: Readonly<Record<MindmapTool, string>> = {
  select: "mindmap.tool-select",
  pan: "mindmap.tool-pan",
  node: "mindmap.new-node",
  shape: "mindmap.shape-picker",
  text: "mindmap.new-text",
  connect: "mindmap.connect",
  frame: "mindmap.new-frame",
  image: "mindmap.new-image",
}

/** The reverse, for a press that has already been resolved to an action id. */
export const TOOL_OF_ACTION: Readonly<Record<string, MindmapTool>> = Object.fromEntries(
  Object.entries(TOOL_ACTIONS).map(([tool, action]) => [action, tool as MindmapTool]),
)

/** The action that arms select in each of its modes. The select action is the box's. */
export const SELECT_MODE_ACTIONS: Readonly<Record<SelectMode, string>> = {
  box: "mindmap.tool-select",
  lasso: "mindmap.tool-lasso",
}

export const SELECT_MODE_OF_ACTION: Readonly<Record<string, SelectMode>> = Object.fromEntries(
  Object.entries(SELECT_MODE_ACTIONS).map(([mode, action]) => [action, mode as SelectMode]),
)

/**
 * Every tool but select is taken back by Escape.
 *
 * The planting tools hand the map back after one use, since planting ten nodes in a row is rare and
 * clicking Select afterwards is not. The hand stays armed across drags. Select never reverts.
 */
export function isOneShot(tool: MindmapTool): boolean {
  return tool !== "select"
}

/**
 * What the pointer looks like while a tool is armed.
 *
 * A class rather than an inline style, because panning writes `grabbing` straight onto the pane and
 * clears it again afterwards. An inline tool cursor would be the thing it cleared.
 */
export function cursorFor(tool: MindmapTool): string | undefined {
  switch (tool) {
    case "node":
    case "shape":
    case "text":
    case "image":
      return "cursor-copy"
    case "connect":
    case "frame":
      return "cursor-crosshair"
    case "pan":
      return "cursor-grab"
    default:
      return undefined
  }
}
