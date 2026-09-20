/** Line edits atomically rebox absolute points into relative stored geometry. */

import type { MovedElement } from "../interaction/controller"
import type { ShapeContent } from "../model/document"
import { op, type MindmapOp } from "../model/ops"
import type { Point, Scene, SceneElement } from "../model/scene"
import {
  absolute,
  anchorPoint,
  isAttachmentTarget,
  lineBox,
  relative,
  type AbsoluteLine,
  type Box,
} from "../scene/line-geometry"

const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })

export function lineContent(existing: ShapeContent, line: AbsoluteLine): { content: ShapeContent; box: Box } {
  const points = [line.start, line.end]
  if (line.bend) {
    points.push(line.bend)
  }
  const raw = lineBox(points)
  const box = { x: Math.round(raw.x), y: Math.round(raw.y), width: Math.round(raw.width), height: Math.round(raw.height) }
  const content: ShapeContent = {
    ...existing,
    line: {
      start: round(relative(line.start, box)),
      end: round(relative(line.end, box)),
      bend: line.bend ? round(relative(line.bend, box)) : null,
      startAt: line.startAt,
      endAt: line.endAt,
    },
  }
  return { content, box }
}

export function lineOps(element: SceneElement, line: AbsoluteLine, moving = false): MindmapOp[] {
  const { content, box } = lineContent(element.content as ShapeContent, line)
  const ops: MindmapOp[] = [op.set(element.id, { content, wh: [box.width, box.height] })]
  if (moving || box.x !== Math.round(element.x) || box.y !== Math.round(element.y)) {
    ops.push(op.moveTo(element.id, box.x, box.y))
  }
  return ops
}

export function rewriteLine(
  scene: Scene,
  element: SceneElement,
  boxAt: (id: string) => Box | undefined,
  delta: Point = { x: 0, y: 0 },
): AbsoluteLine {
  const line = element.line!
  const own = { x: element.x, y: element.y, width: element.width, height: element.height }
  const end = (point: Point, at: AbsoluteLine["startAt"]): Point => {
    if (at) {
      const target = elementsOf(scene).get(at.elementId)
      const box = boxAt(at.elementId)
      if (box && isAttachmentTarget(target)) {
        return anchorPoint(box, at.side ?? "top", target?.rotation)
      }
    }
    const drawn = absolute(point, own)
    return { x: drawn.x + delta.x, y: drawn.y + delta.y }
  }
  const bend = line.bend ? absolute(line.bend, own) : null
  return {
    start: end(line.start, line.startAt),
    end: end(line.end, line.endAt),
    bend: bend ? { x: bend.x + delta.x, y: bend.y + delta.y } : null,
    startAt: line.startAt,
    endAt: line.endAt,
  }
}

export function linesAttachedTo(scene: Scene, ids: ReadonlySet<string>): SceneElement[] {
  return scene.elements.filter(
    (element) =>
      element.line !== undefined &&
      ((element.line.startAt !== null && ids.has(element.line.startAt.elementId)) ||
        (element.line.endAt !== null && ids.has(element.line.endAt.elementId))),
  )
}

export function moveOps(scene: Scene, moves: readonly MovedElement[]): MindmapOp[] {
  const moved = new Map<string, Point>()
  for (const move of moves) {
    moved.set(move.id, { x: Math.round(move.x), y: Math.round(move.y) })
  }
  const elements = elementsOf(scene)
  const boxAt = (id: string): Box | undefined => {
    const element = elements.get(id)
    if (!element) {
      return undefined
    }
    const to = moved.get(id)
    return to ? { x: to.x, y: to.y, width: element.width, height: element.height } : element
  }

  const ops: MindmapOp[] = []
  const rewritten = new Set<string>()
  for (const move of moves) {
    const element = elements.get(move.id)
    const to = moved.get(move.id)!
    if (element?.line && (element.line.startAt || element.line.endAt)) {
      const delta = { x: to.x - Math.round(element.x), y: to.y - Math.round(element.y) }
      ops.push(...lineOps(element, rewriteLine(scene, element, boxAt, delta), true))
      rewritten.add(element.id)
      continue
    }
    ops.push(op.moveTo(move.id, to.x, to.y))
  }
  for (const line of linesAttachedTo(scene, new Set(moved.keys()))) {
    if (rewritten.has(line.id)) {
      continue
    }
    ops.push(...lineOps(line, rewriteLine(scene, line, boxAt)))
  }
  return ops
}

export function resizeLineOps(scene: Scene, id: string, box: Box): MindmapOp[] {
  const elements = elementsOf(scene)
  const boxAt = (candidate: string): Box | undefined => (candidate === id ? box : elements.get(candidate))
  return linesAttachedTo(scene, new Set([id])).flatMap((line) => lineOps(line, rewriteLine(scene, line, boxAt)))
}

export function rotateLineOps(scene: Scene, id: string, degrees: number): MindmapOp[] {
  const element = elementsOf(scene).get(id)
  if (!element || element.kind !== "shape" || element.line) return []

  const rotation = ((Math.round(degrees) % 360) + 360) % 360
  const content: ShapeContent = { ...(element.content as ShapeContent), rotation }
  const rotated = { ...element, content, rotation }
  const updated = {
    ...scene,
    elements: scene.elements.map((candidate) => (candidate.id === id ? rotated : candidate)),
  }
  return [op.set(id, { content }), ...resizeLineOps(updated, id, element)]
}

const indexed = new WeakMap<Scene, Map<string, SceneElement>>()
function elementsOf(scene: Scene): Map<string, SceneElement> {
  const cached = indexed.get(scene)
  if (cached) {
    return cached
  }
  const built = new Map(scene.elements.map((element) => [element.id, element]))
  indexed.set(scene, built)
  return built
}

/** Detaches ends before deletion so the change remains one undo step. */
export function detachOps(scene: Scene, deleted: ReadonlySet<string>): MindmapOp[] {
  const elements = elementsOf(scene)
  const boxAt = (id: string): Box | undefined => elements.get(id)
  const ops: MindmapOp[] = []
  for (const line of linesAttachedTo(scene, deleted)) {
    if (deleted.has(line.id)) {
      continue
    }
    const resolved = rewriteLine(scene, line, boxAt)
    ops.push(
      ...lineOps(line, {
        ...resolved,
        startAt: resolved.startAt && deleted.has(resolved.startAt.elementId) ? null : resolved.startAt,
        endAt: resolved.endAt && deleted.has(resolved.endAt.elementId) ? null : resolved.endAt,
      }),
    )
  }
  return ops
}
