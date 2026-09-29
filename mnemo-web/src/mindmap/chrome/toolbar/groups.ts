/**
 * What the toolbar holds: its tools in order, and the groups of choices some of them own. A group is
 * described once here and placed by the rule in `placement.ts`, so a new one is a new entry.
 */

import { SELECT_MODE_ACTIONS, type MindmapTool } from "../../interaction/tool"
import type { Placeable } from "./placement"

export type GroupId = "select" | "node" | "shape" | "connect"

export interface GroupOption {
  readonly id: string
  /** Translation key in the Mindmap namespace. */
  readonly label: string
  /** The key that picks it while its group is open. */
  readonly key?: string
  /** Or the catalog action that picks it from anywhere, whose chord the option shows instead. */
  readonly action?: string
}

export interface ToolbarGroup extends Placeable {
  readonly id: GroupId
  readonly label: string
  readonly options: readonly GroupOption[]
  /** Put away once a key has picked, so the next digit is not taken as a second pick. */
  readonly closesOnKey?: boolean
}

const numbered = (options: readonly Omit<GroupOption, "key">[]): GroupOption[] =>
  options.map((option, index) => ({ ...option, key: String(index + 1) }))

export const GROUPS: Readonly<Record<GroupId, ToolbarGroup>> = {
  select: {
    id: "select",
    label: "ToolSelect",
    options: [
      { id: "box", label: "ToolSelectBox", action: SELECT_MODE_ACTIONS.box },
      { id: "lasso", label: "ToolLasso", action: SELECT_MODE_ACTIONS.lasso },
    ],
  },
  node: {
    id: "node",
    label: "GroupNodeStyle",
    // Each style is told apart by its name, which only the shelf's caption has room to show.
    alwaysShelf: true,
    options: numbered([
      { id: "card", label: "ShapeCard" },
      { id: "pill", label: "ShapePill" },
      { id: "outline", label: "ShapeOutline" },
      { id: "plain", label: "ShapePlain" },
    ]),
  },
  shape: {
    id: "shape",
    label: "ToolShape",
    closesOnKey: true,
    options: numbered([
      { id: "rectangle", label: "ShapeRectangle" },
      { id: "ellipse", label: "ShapeEllipse" },
      { id: "diamond", label: "ShapeDiamond" },
      { id: "hexagon", label: "ShapeHexagon" },
      { id: "parallelogram", label: "ShapeParallelogram" },
      { id: "line", label: "ShapeLine" },
      { id: "arrow", label: "ShapeArrow" },
      { id: "blob", label: "ShapeBlob" },
    ]),
  },
  connect: {
    id: "connect",
    label: "GroupConnectors",
    options: numbered([
      { id: "curve", label: "RouteCurve" },
      { id: "straight", label: "RouteStraight" },
      { id: "orthogonal", label: "RouteOrthogonal" },
      { id: "arrow", label: "EdgeEndArrow" },
      { id: "both", label: "ConnectorBothEnds" },
      { id: "dashed", label: "EdgeDashed" },
    ]),
  },
}

export interface ToolEntry {
  /** Image is not a tool the canvas can be armed with: it opens a picker and is done. */
  readonly id: MindmapTool | "image"
  readonly label: string
  /** A second tooltip line, for a tool whose name does not say what it writes. */
  readonly detail?: string
  readonly icon?: string
  readonly group?: GroupId
}

export const TOOLBAR: readonly (ToolEntry | "sep")[] = [
  { id: "select", label: "ToolSelect", icon: "mouse-pointer-2", group: "select" },
  { id: "pan", label: "ToolPan", icon: "hand" },
  "sep",
  { id: "node", label: "ToolNode", icon: "square-plus", group: "node" },
  { id: "shape", label: "ToolShape", group: "shape" },
  { id: "text", label: "ToolText", icon: "type" },
  { id: "frame", label: "ToolFrame", icon: "frame" },
  "sep",
  { id: "connect", label: "ToolConnect", detail: "ToolConnectDetail", group: "connect" },
  { id: "image", label: "ToolImage", icon: "common/image" },
]

/** The group a tool owns, if it owns one. */
export function groupOfTool(tool: MindmapTool): ToolbarGroup | null {
  const entry = TOOLBAR.find((item) => item !== "sep" && item.id === tool)
  return entry && entry !== "sep" && entry.group ? GROUPS[entry.group] : null
}

/** The option a key press picks in an open group. */
export function optionForKey(group: ToolbarGroup, key: string): GroupOption | undefined {
  if (key.length !== 1) {
    return undefined
  }
  return group.options.find((option) => option.key === key)
}
