/**
 * What the find bar walks, and where it walks to. No React and no network, so the wrap-around, the
 * ordering and the camera arithmetic are pinned by plain tests.
 */

import type { ElementBox } from "../canvas/edge-paths"
import { MAX_SCALE, type Scene, type Viewport } from "../model/scene"

/**
 * The zoom a match is shown at when the map was further out than this. A label found from an
 * overview is a label somebody wants to read, and centring a dot answers nothing; a map already
 * zoomed in past this keeps the zoom it had.
 */
export const READABLE_ZOOM = 1

/**
 * The hits that are drawn, in the order the scene draws them.
 *
 * The server answers in index order, which after a few edits is no order at all, and a walk that
 * jumps about the map is a walk nobody can keep their place in. Hits the scene does not hold, which
 * is any element under a collapsed branch, are left out: there is nothing to centre on.
 */
export function inSceneOrder(hitIds: Iterable<string>, scene: Scene): string[] {
  const wanted = new Set(hitIds)
  if (wanted.size === 0) {
    return []
  }
  const ordered: string[] = []
  for (const element of scene.elements) {
    if (wanted.has(element.id)) {
      ordered.push(element.id)
    }
  }
  return ordered
}

/** The next index in the walk, wrapping at either end. Negative one when there is nothing to walk. */
export function stepIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) {
    return -1
  }
  if (index < 0) {
    return direction === 1 ? 0 : count - 1
  }
  return (index + direction + count) % count
}

/** The camera that puts this box in the middle of the pane, at a zoom its label can be read at. */
export function cameraOn(box: ElementBox, paneWidth: number, paneHeight: number, zoom: number): Viewport {
  const next = Math.min(MAX_SCALE, Math.max(zoom, READABLE_ZOOM))
  return {
    zoom: next,
    x: box.x + box.width / 2 - paneWidth / (2 * next),
    y: box.y + box.height / 2 - paneHeight / (2 * next),
  }
}
