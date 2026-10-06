import {
  OCCLUSION_MAX_MASKS,
  OCCLUSION_MAX_POINTS,
  type OcclusionDocument,
  type OcclusionMask,
  type OcclusionMode,
} from "../../facts/occlusion"
import { resizeBox, type ResizeDir } from "@/mindmap/interaction/resize"

import type { Size } from "../geometry"
import { roomForMasks, type Mint } from "./ids"
import { fitBox, shifted, unionBox, withBox, withPoints, type Point } from "./shape"

/** A document plus the ids the operation produced, so the caller can select them. */
export interface OpResult {
  document: OcclusionDocument
  ids: string[]
}

/** The finest step a stored coordinate can take. */
const QUANTUM = 0.0001

export type NewShape =
  | { shape: "rect" | "ellipse"; x: number; y: number; w: number; h: number }
  | { shape: "polygon"; points: Point[] }

function nextOrder(document: OcclusionDocument): number {
  return document.masks.reduce((top, mask) => Math.max(top, mask.order + 1), 0)
}

function mapMasks(
  document: OcclusionDocument,
  ids: ReadonlySet<string>,
  change: (mask: OcclusionMask) => OcclusionMask,
): OcclusionDocument {
  let changed = false
  const masks = document.masks.map((mask) => {
    if (!ids.has(mask.id)) return mask
    const next = change(mask)
    if (next !== mask) changed = true
    return next
  })
  return changed ? { ...document, masks } : document
}

/**
 * Appends a mask as the last card, clamped to the image. No area, a polygon under three points or
 * a full document comes back unchanged; polygon points past the cap are dropped.
 */
export function addMask(document: OcclusionDocument, spec: NewShape, id: string): OpResult {
  const none = { document, ids: [] }
  if (!roomForMasks(document)) return none

  const order = nextOrder(document)
  if (spec.shape === "polygon") {
    const points = spec.points.slice(0, OCCLUSION_MAX_POINTS)
    if (points.length < 3) return none
    const mask = withPoints({ id, shape: "polygon", x: 0, y: 0, w: 0, h: 0, order }, points)
    if (mask.w <= 0 || mask.h <= 0) return none
    return { document: { ...document, masks: [...document.masks, mask] }, ids: [id] }
  }

  const mask: OcclusionMask = { id, shape: spec.shape, ...fitBox(spec), order }
  if (mask.w <= 0 || mask.h <= 0) return none
  return { document: { ...document, masks: [...document.masks, mask] }, ids: [id] }
}

/** Replaces the box of a mask drawn so far, for the live preview of a drawing drag. */
export function setBox(document: OcclusionDocument, id: string, box: { x: number; y: number; w: number; h: number }): OcclusionDocument {
  return mapMasks(document, new Set([id]), (mask) => withBox(mask, box))
}

/**
 * Moves masks by a delta in image fractions. The delta is trimmed so the selection as a whole
 * stays inside the image, which keeps its members' relative positions.
 */
export function moveMasks(document: OcclusionDocument, ids: readonly string[], dx: number, dy: number): OcclusionDocument {
  const wanted = new Set(ids)
  const moving = document.masks.filter((mask) => wanted.has(mask.id))
  if (moving.length === 0) return document

  const box = unionBox(moving)
  const fx = Math.min(Math.max(dx, -box.x), 1 - (box.x + box.w))
  const fy = Math.min(Math.max(dy, -box.y), 1 - (box.y + box.h))
  if (fx === 0 && fy === 0) return document
  return mapMasks(document, wanted, (mask) => shifted(mask, fx, fy))
}

/** A step that rounds to nothing at the stored precision still moves one quantum, so a nudge never does nothing. */
function quantized(step: number): number {
  return step !== 0 && Math.abs(step) < QUANTUM / 2 ? Math.sign(step) * QUANTUM : step
}

/** Moves masks by whole screen pixels, converting through the displayed size of the image. */
export function nudgeMasks(document: OcclusionDocument, ids: readonly string[], dxPx: number, dyPx: number, size: Size): OcclusionDocument {
  if (size.w <= 0 || size.h <= 0) return document
  return moveMasks(document, ids, quantized(dxPx / size.w), quantized(dyPx / size.h))
}

export interface ResizeOptions {
  /** The displayed size of the whole image in pixels. */
  size: Size
  /** Smallest width or height, in pixels. */
  minPx: number
  lockAspect?: boolean
}

/**
 * Drags one handle of a rectangle or ellipse by a pixel delta from where the gesture began.
 * Polygons are reshaped by their points instead and come back unchanged.
 */
export function resizeMask(
  document: OcclusionDocument,
  id: string,
  dir: ResizeDir,
  dxPx: number,
  dyPx: number,
  options: ResizeOptions,
): OcclusionDocument {
  const { size, minPx, lockAspect = false } = options
  const mask = document.masks.find((m) => m.id === id)
  if (!mask || mask.shape === "polygon" || size.w <= 0 || size.h <= 0) return document

  const origin = { x: mask.x * size.w, y: mask.y * size.h, width: mask.w * size.w, height: mask.h * size.h }
  const grown = resizeBox(origin, dir, dxPx, dyPx, lockAspect, minPx)
  // The floor applies to the axes the handle moves; a side handle leaves the other axis as it was.
  const moves = { x: dir.includes("e") || dir.includes("w"), y: dir.includes("n") || dir.includes("s") }
  const fixed = {
    x: moves.x ? grown.x : origin.x,
    width: moves.x ? grown.width : origin.width,
    y: moves.y ? grown.y : origin.y,
    height: moves.y ? grown.height : origin.height,
  }

  const placed = lockAspect && moves.x && moves.y ? scaledInside(origin, fixed, dir, size) : clipped(fixed, size)
  const box = { x: placed.x / size.w, y: placed.y / size.h, w: placed.width / size.w, h: placed.height / size.h }
  return mapMasks(document, new Set([id]), (m) => withBox(m, box))
}

/** Moves one vertex of a polygon. A move that would flatten it to no width or height is refused, as the stored form drops such a mask. */
export function movePoint(document: OcclusionDocument, id: string, index: number, to: Point): OcclusionDocument {
  return mapMasks(document, new Set([id]), (mask) => {
    if (mask.shape !== "polygon" || !mask.points || index < 0 || index >= mask.points.length) return mask
    const points = mask.points.map((p, i): Point => (i === index ? to : p))
    const moved = withPoints(mask, points)
    return moved.w <= 0 || moved.h <= 0 ? mask : moved
  })
}

/** Sets or clears a mask's label. */
export function renameMask(document: OcclusionDocument, id: string, label: string): OcclusionDocument {
  const text = label.trim()
  return mapMasks(document, new Set([id]), (mask) => {
    if ((mask.label ?? "") === text) return mask
    const { label: _old, ...rest } = mask
    return text ? { ...rest, label: text } : rest
  })
}

export function setMode(document: OcclusionDocument, mode: OcclusionMode): OcclusionDocument {
  return document.mode === mode ? document : { ...document, mode }
}

/** Removes masks. A group left with one member keeps its label. */
export function deleteMasks(document: OcclusionDocument, ids: readonly string[]): OcclusionDocument {
  const doomed = new Set(ids)
  const masks = document.masks.filter((mask) => !doomed.has(mask.id))
  return masks.length === document.masks.length ? document : { ...document, masks }
}

/**
 * Copies masks to the end of the card order with new ids, offset so the copy is visible. A copied
 * group becomes a new group. All copies are made or none when they would pass the mask cap.
 */
export function duplicateMasks(document: OcclusionDocument, ids: readonly string[], mint: Mint, offset = 0.02): OpResult {
  const wanted = new Set(ids)
  const sources = [...document.masks].filter((mask) => wanted.has(mask.id)).sort((a, b) => a.order - b.order)
  if (sources.length === 0 || document.masks.length + sources.length > OCCLUSION_MAX_MASKS) return { document, ids: [] }

  const box = unionBox(sources)
  const fx = Math.min(offset, 1 - (box.x + box.w))
  const fy = Math.min(offset, 1 - (box.y + box.h))
  const dx = fx > 0 ? fx : -Math.min(offset, box.x)
  const dy = fy > 0 ? fy : -Math.min(offset, box.y)

  let order = nextOrder(document)
  const copies = sources.map((source) => {
    const { group: _group, ...rest } = source
    return { ...shifted({ ...rest, id: mint() }, dx, dy), order: order++ }
  })

  // Members that shared a group share a new one, named for the first copy, so a copied group is one card.
  const firstCopy = new Map<string, string>()
  const sizes = new Map<string, number>()
  sources.forEach((source, i) => {
    if (!source.group) return
    if (!firstCopy.has(source.group)) firstCopy.set(source.group, copies[i].id)
    sizes.set(source.group, (sizes.get(source.group) ?? 0) + 1)
  })
  copies.forEach((copy, i) => {
    const label = sources[i].group
    if (label && (sizes.get(label) ?? 0) > 1) copy.group = firstCopy.get(label)
  })
  return { document: { ...document, masks: [...document.masks, ...copies] }, ids: copies.map((mask) => mask.id) }
}

/** The bounding box of masks that exist, for placing a bar or a rubber band. */
export function boxOfMasks(document: OcclusionDocument, ids: readonly string[]) {
  const wanted = new Set(ids)
  const found = document.masks.filter((mask) => wanted.has(mask.id))
  return found.length === 0 ? null : unionBox(found)
}

interface PxBox {
  x: number
  y: number
  width: number
  height: number
}

function clipped(box: PxBox, size: Size): PxBox {
  const left = Math.max(0, box.x)
  const top = Math.max(0, box.y)
  return { x: left, y: top, width: Math.min(size.w, box.x + box.width) - left, height: Math.min(size.h, box.y + box.height) - top }
}

/** Shrinks an aspect-locked box about its fixed corner until it fits, so the lock survives the image edge. */
function scaledInside(origin: PxBox, box: PxBox, dir: ResizeDir, size: Size): PxBox {
  const west = dir.includes("w")
  const north = dir.includes("n")
  const ax = west ? origin.x + origin.width : origin.x
  const ay = north ? origin.y + origin.height : origin.y
  const scale = Math.min(1, (west ? ax : size.w - ax) / box.width, (north ? ay : size.h - ay) / box.height)
  const width = box.width * scale
  const height = box.height * scale
  return { x: west ? ax - width : ax, y: north ? ay - height : ay, width, height }
}
