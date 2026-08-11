/**
 * What a press on the canvas means.
 *
 * Panning is deliberately not in here. It is available inside every tool, on the middle button and
 * on alt-drag, because having to leave the tool you are using to move the surface you are using it
 * on is the one thing a canvas app can get wrong that nothing else makes up for.
 */

export type MindmapTool = "select" | "node" | "shape" | "text" | "connect"

/** The letter that arms each tool: one press, no modifier, and not while a field has the keyboard. */
export const TOOL_KEYS: Readonly<Record<string, MindmapTool>> = {
  v: "select",
  n: "node",
  s: "shape",
  t: "text",
  c: "connect",
}

/** The letter shown next to a tool's name, so the dock teaches its own shortcuts. */
export const TOOL_KEY_OF: Readonly<Record<MindmapTool, string>> = {
  select: "V",
  node: "N",
  shape: "S",
  text: "T",
  connect: "C",
}

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
      return "cursor-crosshair"
    default:
      return undefined
  }
}
