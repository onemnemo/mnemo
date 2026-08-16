/**
 * What a press on the canvas means.
 *
 * Panning is deliberately not in here. It is available inside every tool, on the middle button and
 * on alt-drag, because having to leave the tool you are using to move the surface you are using it
 * on is the one thing a canvas app can get wrong that nothing else makes up for.
 */

export type MindmapTool = "select" | "node" | "shape" | "text" | "connect" | "frame"

/**
 * The action that arms each tool.
 *
 * Which key that is belongs to the keybind catalog, not here, so the dock shows whatever someone
 * has bound and a rebind moves the letter on the tooltip along with the key that works.
 */
export const TOOL_ACTIONS: Readonly<Record<MindmapTool, string>> = {
  select: "mindmap.tool-select",
  node: "mindmap.new-node",
  shape: "mindmap.shape-picker",
  text: "mindmap.new-text",
  connect: "mindmap.connect",
  frame: "mindmap.new-frame",
}

/** The reverse, for a press that has already been resolved to an action id. */
export const TOOL_OF_ACTION: Readonly<Record<string, MindmapTool>> = Object.fromEntries(
  Object.entries(TOOL_ACTIONS).map(([tool, action]) => [action, tool as MindmapTool]),
)

/**
 * Every tool but select does one thing and hands the map back.
 *
 * Planting ten nodes in a row is rare and clicking Select afterwards is not, so the common case is
 * the one that costs nothing. Select is the resting state and never reverts to anything.
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
      return "cursor-copy"
    case "connect":
    case "frame":
      return "cursor-crosshair"
    default:
      return undefined
  }
}
