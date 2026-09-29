/**
 * Putting a picture into an image element, as data: which element a drop lands on, and the edit
 * that swaps the file and refits the box.
 */

import { resizeLineOps } from "../edit/line-ops"
import type { CanvasImageContent } from "../model/document"
import { op, type MindmapOp } from "../model/ops"
import type { Point, Scene, SceneElement } from "../model/scene"
import { centreOf, rotateVector } from "../scene/element-geometry"

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** An image element still waiting for its picture. */
export function isImageSlot(element: SceneElement | null | undefined): element is SceneElement {
  return (
    element?.kind === "image" &&
    element.content.$type === "canvasImage" &&
    !(element.content as CanvasImageContent).assetId
  )
}

/**
 * The empty image a drop at this point lands on: the topmost element there, when that is one. Frames
 * and lines are passed over, since a press goes through a frame's middle and beside a line.
 */
export function slotAt(scene: Scene, point: Point): SceneElement | null {
  for (let index = scene.elements.length - 1; index >= 0; index -= 1) {
    const element = scene.elements[index]
    if (element.kind === "frame" || element.line || !contains(element, point)) {
      continue
    }
    return isImageSlot(element) ? element : null
  }
  return null
}

function contains(element: SceneElement, point: Point): boolean {
  const centre = centreOf(element)
  const local = rotateVector(point.x - centre.x, point.y - centre.y, -(element.rotation ?? 0))
  return Math.abs(local.x) <= element.width / 2 && Math.abs(local.y) <= element.height / 2
}

/**
 * One edit that gives an image element new content and a new size about the same centre.
 *
 * Null when the element is gone, which after an upload is an answer rather than a fault: the
 * placeholder was deleted or undone while the file was on its way.
 */
export function refitImage(
  scene: Scene,
  id: string,
  content: CanvasImageContent,
  size: readonly [number, number],
): { ops: MindmapOp[]; box: Box } | null {
  const element = scene.elements.find((candidate) => candidate.id === id)
  if (!element || element.kind !== "image") {
    return null
  }
  const [width, height] = size
  const box: Box = {
    x: Math.round(element.x + element.width / 2 - width / 2),
    y: Math.round(element.y + element.height / 2 - height / 2),
    width,
    height,
  }
  const ops: MindmapOp[] = [op.set(id, { content, wh: [width, height] })]
  if (box.x !== Math.round(element.x) || box.y !== Math.round(element.y)) {
    ops.push(op.moveTo(id, box.x, box.y))
  }
  ops.push(...resizeLineOps(scene, id, box))
  return { ops, box }
}

/** A box of the crop's shape at the width the picture already has. */
export function croppedSize(width: number, aspect: number): [number, number] {
  return [Math.round(width), Math.max(1, Math.round(width / aspect))]
}
