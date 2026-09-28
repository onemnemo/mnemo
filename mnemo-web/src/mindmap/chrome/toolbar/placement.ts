/**
 * Where the toolbar and everything it opens go, as arithmetic along the bar's own axis and across
 * it, so one set of numbers serves both orientations. Offsets are from the bar's top-left corner
 * unless a function says it answers in pane pixels.
 */

import type { Point } from "../../model/scene"

export type DockEdge = "bottom" | "top" | "left" | "right"

export interface Size {
  readonly width: number
  readonly height: number
}

/** A group this small barely widens the bar, so it opens inside it rather than beside it. */
export const INLINE_MAX = 4

export const BAR_THICKNESS = 48
export const BAR_PADDING = 6
export const GRIP_LENGTH = 20
export const TOOL_STEP = 38
export const SEP_LENGTH = 13

/** Between the bar and the pane edge it docks to. */
export const DOCK_INSET = 16
/** Between the bar and a shelf it opens. */
export const SHELF_GAP = 8
export const SHELF_THICKNESS = 44
const SHELF_OPTION_STEP = 34
const SHELF_CAPTION = 104

/** Between the bar and anything else that has to keep clear of it. */
const CLEARANCE_GAP = 8

export interface Placeable {
  readonly alwaysShelf?: boolean
  readonly options: readonly unknown[]
}

export function placementOf(group: Placeable): "inline" | "shelf" {
  return group.alwaysShelf || group.options.length > INLINE_MAX ? "shelf" : "inline"
}

export const isVertical = (edge: DockEdge): boolean => edge === "left" || edge === "right"

/** The sunken strip itself: options 32 wide with 2 between, inside 3 of padding. */
export function inlineLength(count: number): number {
  return count * 32 + (count - 1) * 2 + 6
}

/** What an open strip adds to the bar, with its 3 of margin either side. */
export function inlineSlot(count: number): number {
  return inlineLength(count) + 6
}

export type BarItem =
  | { readonly kind: "grip" }
  | { readonly kind: "sep" }
  | { readonly kind: "tool"; readonly id: string }
  | { readonly kind: "tray"; readonly group: string; readonly count: number }

export interface BarLayout {
  /** Each item's offset along the axis, in the order given. */
  readonly offsets: readonly number[]
  readonly length: number
}

/** Lays the items end to end. Only the tray of the group that is open inline takes any room. */
export function barLayout(items: readonly BarItem[], openInline: string | null): BarLayout {
  let at = BAR_PADDING
  const offsets = items.map((item) => {
    const start = at
    at += itemLength(item, openInline)
    return start
  })
  return { offsets, length: at + BAR_PADDING }
}

function itemLength(item: BarItem, openInline: string | null): number {
  switch (item.kind) {
    case "grip":
      return GRIP_LENGTH
    case "sep":
      return SEP_LENGTH
    case "tool":
      return TOOL_STEP
    case "tray":
      return item.group === openInline ? inlineSlot(item.count) : 0
  }
}

export function barSize(edge: DockEdge, length: number): Size {
  return isVertical(edge)
    ? { width: BAR_THICKNESS, height: length }
    : { width: length, height: BAR_THICKNESS }
}

/** A shelf is always a horizontal strip: its options, a divider, and the caption naming one of them. */
export function shelfSize(count: number): Size {
  return { width: 8 + count * SHELF_OPTION_STEP - 2 + 11 + SHELF_CAPTION, height: SHELF_THICKNESS }
}

/**
 * Where a shelf goes, on the canvas side of the bar: centred on the tool that opened it and kept
 * from overhanging either end, or centred on the bar when it is longer than the bar.
 */
export function shelfPosition(edge: DockEdge, bar: Size, toolCenter: number, shelf: Size): Point {
  if (isVertical(edge)) {
    return {
      x: edge === "left" ? bar.width + SHELF_GAP : -SHELF_GAP - shelf.width,
      y: along(toolCenter, shelf.height, bar.height),
    }
  }
  return {
    x: along(toolCenter, shelf.width, bar.width),
    y: edge === "top" ? bar.height + SHELF_GAP : -SHELF_GAP - shelf.height,
  }
}

function along(center: number, length: number, room: number): number {
  if (length > room) {
    return (room - length) / 2
  }
  return Math.min(Math.max(center - length / 2, 0), room - length)
}

/** Which way the shelf slides in from: toward the bar, across it. */
export function shelfTravel(edge: DockEdge): Point {
  switch (edge) {
    case "bottom":
      return { x: 0, y: 1 }
    case "top":
      return { x: 0, y: -1 }
    case "left":
      return { x: -1, y: 0 }
    case "right":
      return { x: 1, y: 0 }
  }
}

/** The block in the pane's bottom-right corner that other chrome owns; an empty corner is zero. */
export type CornerReserve = Size

/**
 * The bar's top-left in pane pixels: 16 in from its edge and centred along it, then moved along the
 * edge to clear the corner block if it can. A bar that cannot clear it stays centred.
 */
export function dockOrigin(edge: DockEdge, pane: Size, bar: Size, reserve: CornerReserve): Point {
  if (isVertical(edge)) {
    const x = edge === "left" ? DOCK_INSET : pane.width - DOCK_INSET - bar.width
    let y = (pane.height - bar.height) / 2
    if (edge === "right" && reserve.height > 0) {
      const limit = pane.height - reserve.height - CLEARANCE_GAP
      if (y + bar.height > limit && limit - bar.height >= DOCK_INSET) {
        y = limit - bar.height
      }
    }
    return { x, y }
  }
  const y = edge === "top" ? DOCK_INSET : pane.height - DOCK_INSET - bar.height
  let x = (pane.width - bar.width) / 2
  if (edge === "bottom" && reserve.width > 0) {
    const limit = pane.width - reserve.width - CLEARANCE_GAP
    if (x + bar.width > limit && limit - bar.width >= DOCK_INSET) {
      x = limit - bar.width
    }
  }
  return { x, y }
}

/**
 * Whether a bar of this length has room on an edge. The right edge must also clear the corner block,
 * which holds the view controls. The bottom never refuses: it is where everything falls back to.
 */
export function fitsEdge(edge: DockEdge, pane: Size, length: number, reserve: CornerReserve): boolean {
  switch (edge) {
    case "bottom":
      return true
    case "top":
      return length + 2 * DOCK_INSET <= pane.width
    case "left":
      return length + 2 * DOCK_INSET <= pane.height
    case "right":
      return length + 2 * DOCK_INSET + Math.max(0, reserve.height - DOCK_INSET + CLEARANCE_GAP) <= pane.height
  }
}

export function resolveEdge(edge: DockEdge, pane: Size, length: number, reserve: CornerReserve): DockEdge {
  return fitsEdge(edge, pane, length, reserve) ? edge : "bottom"
}

const EDGES: readonly DockEdge[] = ["bottom", "top", "left", "right"]

/** The edge nearest a pane point, among the ones that would take the bar. Ties go to the bottom. */
export function nearestEdge(point: Point, pane: Size, allowed: readonly DockEdge[] = EDGES): DockEdge {
  const distance: Record<DockEdge, number> = {
    bottom: pane.height - point.y,
    top: point.y,
    left: point.x,
    right: pane.width - point.x,
  }
  let best: DockEdge = "bottom"
  let bestDistance = Infinity
  for (const edge of EDGES) {
    if (allowed.includes(edge) && distance[edge] < bestDistance) {
      best = edge
      bestDistance = distance[edge]
    }
  }
  return best
}

/** Where an arrow key sends the dock: the edge it points at. */
export function edgeForArrow(key: string): DockEdge | null {
  switch (key) {
    case "ArrowDown":
      return "bottom"
    case "ArrowUp":
      return "top"
    case "ArrowLeft":
      return "left"
    case "ArrowRight":
      return "right"
    default:
      return null
  }
}

export function parseEdge(value: string): DockEdge {
  return EDGES.find((edge) => edge === value) ?? "bottom"
}

/**
 * How much of each pane edge the docked bar owns, for the bars that float over the canvas and have
 * to stay off it. Only the docked edge has any.
 */
export function dockClearance(edge: DockEdge): Record<DockEdge, number> {
  const clear = { bottom: 0, top: 0, left: 0, right: 0 }
  clear[edge] = DOCK_INSET + BAR_THICKNESS + CLEARANCE_GAP
  return clear
}
