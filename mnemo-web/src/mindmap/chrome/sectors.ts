/**
 * What the ring offers, and when.
 *
 * Two sets rather than one with half its wedges greyed out: a ring is a gesture, and the whole point
 * of it is that a direction always means the same thing. A set that changed size with the selection
 * would move every sector, so the two sets are fixed and the selection only chooses between them.
 *
 * Kept away from the component that draws them because these are the port's decisions about what a
 * map can do, and the ring is a control that would draw any list it was handed.
 */

import type { RadialSector } from "./radial"

/**
 * With a node selected. Six things you do to a node.
 *
 * Branch colour is in the prototype's ring and not in this one. Stepping a branch's hue needs the
 * cascade to be told which of the eight it is now on, and there is nowhere in the model that says so
 * yet, so it waits for the node bar rather than sitting here doing nothing.
 */
export const ON_NODE: readonly RadialSector[] = [
  { id: "child", labelKey: "AddChild", icon: "plus" },
  { id: "connect", labelKey: "Connect", icon: "spline" },
  { id: "delete", labelKey: "Delete", icon: "trash-2", danger: true },
  { id: "sibling", labelKey: "AddSibling", icon: "corner-down-left" },
  { id: "collapse", labelKey: "ToggleCollapse", icon: "common/chevrons-up-down" },
  { id: "edit", labelKey: "Edit", icon: "pencil" },
]

/** With nothing selected. Five things you do to the map. */
export const ON_CANVAS: readonly RadialSector[] = [
  { id: "node", labelKey: "AddNode", icon: "plus" },
  { id: "shape", labelKey: "ToolShape", icon: "square" },
  { id: "arrange", labelKey: "Layout", icon: "common/sitemap" },
  { id: "fit", labelKey: "FitToScreen", icon: "maximize" },
  { id: "text", labelKey: "AddText", icon: "type" },
]
