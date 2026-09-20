import type { Bounds, MeasuredText, Point, SceneLine } from "../model/scene"

export interface ElementGeometryBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DrawnElementBox extends ElementGeometryBox {
  readonly rotation?: number
  readonly line?: SceneLine
  readonly text?: Pick<MeasuredText, "lines" | "width" | "height">
  readonly padding?: { readonly x: number; readonly y: number }
}

export function centreOf(box: ElementGeometryBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function rotateVector(x: number, y: number, degrees: number): Point {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  }
}

export function pointOnRotatedBoxToward(
  box: ElementGeometryBox,
  degrees: number,
  toward: Point,
): Point {
  const centre = centreOf(box)
  const local = rotateVector(toward.x - centre.x, toward.y - centre.y, -degrees)
  if (local.x === 0 && local.y === 0) return centre

  const horizontal = local.x === 0 ? Infinity : box.width / 2 / Math.abs(local.x)
  const vertical = local.y === 0 ? Infinity : box.height / 2 / Math.abs(local.y)
  const distance = Math.min(horizontal, vertical)
  const edge = rotateVector(local.x * distance, local.y * distance, degrees)
  return { x: centre.x + edge.x, y: centre.y + edge.y }
}

export function rotatedBounds(box: ElementGeometryBox, degrees: number): ElementGeometryBox {
  if (!degrees) return box
  const centre = centreOf(box)
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((point) => {
    const turned = rotateVector(point.x - centre.x, point.y - centre.y, degrees)
    return { x: centre.x + turned.x, y: centre.y + turned.y }
  })
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function lineLabelSize(element: Pick<DrawnElementBox, "text" | "padding">): {
  readonly width: number
  readonly height: number
} {
  return {
    width: (element.text?.width ?? 0) + (element.padding?.x ?? 0) * 2,
    height: (element.text?.height ?? 0) + (element.padding?.y ?? 0) * 2,
  }
}

export function lineLabelPoint(line: Pick<SceneLine, "start" | "end" | "bend">): Point {
  return line.bend
    ? {
        x: (line.start.x + 2 * line.bend.x + line.end.x) / 4,
        y: (line.start.y + 2 * line.bend.y + line.end.y) / 4,
      }
    : {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
      }
}

export function hasLineCaption(element: Pick<DrawnElementBox, "text">): boolean {
  return (
    element.text !== undefined &&
    element.text.lines.some((value) => value.length > 0) &&
    (element.text.width ?? 0) > 0 &&
    (element.text.height ?? 0) > 0
  )
}

function lineCaptionBounds(element: DrawnElementBox, line: SceneLine): Bounds | null {
  if (!hasLineCaption(element)) return null
  const { width, height } = lineLabelSize(element)
  const point = lineLabelPoint(line)
  const x = element.x + point.x
  const y = element.y + point.y
  return {
    minX: x - width / 2,
    minY: y - height / 2,
    maxX: x + width / 2,
    maxY: y + height / 2,
  }
}

export function drawnBoundsOf(element: DrawnElementBox, line = element.line): Bounds {
  if (line) {
    const caption = lineCaptionBounds(element, line)
    if (!caption) return line.extent
    return {
      minX: Math.min(line.extent.minX, caption.minX),
      minY: Math.min(line.extent.minY, caption.minY),
      maxX: Math.max(line.extent.maxX, caption.maxX),
      maxY: Math.max(line.extent.maxY, caption.maxY),
    }
  }

  const box = rotatedBounds(element, element.rotation ?? 0)
  return {
    minX: box.x,
    minY: box.y,
    maxX: box.x + box.width,
    maxY: box.y + box.height,
  }
}

export function boxFromBounds(bounds: Bounds): ElementGeometryBox {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}
