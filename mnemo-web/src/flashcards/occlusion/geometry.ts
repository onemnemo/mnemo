/**
 * Pure image and mask geometry shared by review and the mask editor. Masks are fractions of the
 * image, so everything here converts between those fractions and pixels of a fitted image.
 */

import type { OcclusionMask } from "../facts/occlusion"

export interface Size {
  w: number
  h: number
}

/** A rectangle in image fractions (0 to 1) or in pixels, depending on where it is used. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** How far into the image the stage is looking: a zoom over fit, and the fraction at the centre. */
export interface View {
  scale: number
  cx: number
  cy: number
}

export const FIT_VIEW: View = { scale: 1, cx: 0.5, cy: 0.5 }
export const MAX_SCALE = 4
export const ZOOM_STEP = 2

/** With more masks than this a badge shows only where it is needed. */
export const BADGE_DENSE_COUNT = 15
/** A badge is dropped on a mask shorter than this many pixels. */
export const BADGE_MIN_HEIGHT = 20
/** Zoom over fit at which every badge shows again on a dense image. */
export const BADGE_DENSE_ZOOM = 2

/** Pointer travel under this many pixels is still a click. */
export const DRAG_THRESHOLD = 4

const GLYPH_MIN = 9
const GLYPH_MAX = 19
const GLYPH_RATIO = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** The mask's box in image fractions. A polygon's box is already derived from its points. */
export function maskBox(mask: Pick<OcclusionMask, "x" | "y" | "w" | "h">): Box {
  return { x: mask.x, y: mask.y, w: mask.w, h: mask.h }
}

/** A polygon as an SVG `points` value in image fractions, for a `0 0 1 1` view box. */
export function polygonPoints(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ")
}

/** The largest size of the image's aspect that fits inside `room`, in whole pixels. */
export function fitSize(natural: Size, room: Size): Size {
  if (natural.w <= 0 || natural.h <= 0 || room.w <= 0 || room.h <= 0) return { w: 0, h: 0 }
  const ratio = Math.min(room.w / natural.w, room.h / natural.h)
  return { w: Math.round(natural.w * ratio), h: Math.round(natural.h * ratio) }
}

/** Review stops at fit; the editor passes a lower `minScale` to zoom out past it. */
export function clampScale(scale: number, maxScale = MAX_SCALE, minScale = 1): number {
  return clamp(scale, minScale, maxScale)
}

/**
 * The view with its centre pulled back so the image still covers the box on every axis where it
 * is bigger than the box. On an axis where it is smaller the centre is irrelevant and is reset.
 */
export function clampView(view: View, box: Size, fitted: Size, maxScale = MAX_SCALE, minScale = 1): View {
  const scale = clampScale(view.scale, maxScale, minScale)
  const iw = fitted.w * scale
  const ih = fitted.h * scale
  const axis = (center: number, image: number, room: number) =>
    image <= room || image <= 0 ? 0.5 : clamp(center, room / 2 / image, 1 - room / 2 / image)
  return { scale, cx: axis(view.cx, iw, box.w), cy: axis(view.cy, ih, box.h) }
}

/** Where the zoomed image sits inside the box, in pixels. The image is centred on any axis it fits. */
export function viewFrame(view: View, box: Size, fitted: Size, maxScale = MAX_SCALE, minScale = 1): Box {
  const { scale, cx, cy } = clampView(view, box, fitted, maxScale, minScale)
  const w = fitted.w * scale
  const h = fitted.h * scale
  const place = (center: number, image: number, room: number) =>
    image <= room ? (room - image) / 2 : clamp(room / 2 - center * image, room - image, 0)
  return { x: Math.round(place(cx, w, box.w)), y: Math.round(place(cy, h, box.h)), w: Math.round(w), h: Math.round(h) }
}

/** The centre of the bounding box of several masks, in image fractions. */
export function centerOfMasks(masks: readonly Pick<OcclusionMask, "x" | "y" | "w" | "h">[]): { cx: number; cy: number } {
  if (masks.length === 0) return { cx: 0.5, cy: 0.5 }
  const left = Math.min(...masks.map((mask) => mask.x))
  const top = Math.min(...masks.map((mask) => mask.y))
  const right = Math.max(...masks.map((mask) => mask.x + mask.w))
  const bottom = Math.max(...masks.map((mask) => mask.y + mask.h))
  return { cx: (left + right) / 2, cy: (top + bottom) / 2 }
}

/** A view at `scale` centred on a point of the image. */
export function zoomOnto(scale: number, center: { cx: number; cy: number }, box: Size, fitted: Size, maxScale = MAX_SCALE, minScale = 1): View {
  return clampView({ scale, ...center }, box, fitted, maxScale, minScale)
}

/**
 * The view after scaling by `factor` with the image point under `anchor` (a pixel inside the box)
 * staying where it is, so a wheel or pinch zooms toward the pointer.
 */
export function zoomAt(
  view: View,
  factor: number,
  anchor: { x: number; y: number },
  box: Size,
  fitted: Size,
  maxScale = MAX_SCALE,
  minScale = 1,
): View {
  const before = viewFrame(view, box, fitted, maxScale, minScale)
  const scale = clampScale(view.scale * factor, maxScale, minScale)
  if (before.w <= 0 || before.h <= 0) return clampView({ ...view, scale }, box, fitted, maxScale, minScale)

  const u = (anchor.x - before.x) / before.w
  const v = (anchor.y - before.y) / before.h
  const w = fitted.w * scale
  const h = fitted.h * scale
  const next = { scale, cx: (box.w / 2 - (anchor.x - u * w)) / w, cy: (box.h / 2 - (anchor.y - v * h)) / h }
  return clampView(next, box, fitted, maxScale, minScale)
}

/** The view after dragging the image by a pixel delta. */
export function panBy(view: View, dx: number, dy: number, box: Size, fitted: Size, maxScale = MAX_SCALE, minScale = 1): View {
  const w = fitted.w * view.scale
  const h = fitted.h * view.scale
  if (w <= 0 || h <= 0) return view
  return clampView({ scale: view.scale, cx: view.cx - dx / w, cy: view.cy - dy / h }, box, fitted, maxScale, minScale)
}

/** Size of the "?" on the asked mask: 0.6 of the mask height, kept between 9 and 19 pixels. */
export function glyphSize(maskHeightPx: number): number {
  return Math.round(clamp(maskHeightPx * GLYPH_RATIO, GLYPH_MIN, GLYPH_MAX))
}

export interface BadgeInput {
  maskCount: number
  maskHeightPx: number
  selected: boolean
  grouped: boolean
  hovered: boolean
  /** Zoom over fit. */
  zoom: number
}

/** Whether a mask shows its number badge. */
export function badgeVisible(input: BadgeInput): boolean {
  if (input.maskHeightPx < BADGE_MIN_HEIGHT) return false
  if (input.maskCount <= BADGE_DENSE_COUNT) return true
  return input.selected || input.grouped || input.hovered || input.zoom >= BADGE_DENSE_ZOOM
}
