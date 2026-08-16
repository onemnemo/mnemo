/**
 * On-screen accounting, computed from the fixture rather than from the renderer.
 *
 * Shared deliberately. This is the number that tells a reader whether a culling arm dodged the
 * work or genuinely did it, so two arms computing it two ways would make the comparison between
 * them meaningless in exactly the place it matters most.
 */

import type { OnScreenCounts, Viewport } from '../../harness/contract'
import type { MindmapFixture } from '../../fixture/model'

export function countOnScreen(
  fixture: MindmapFixture,
  viewport: Viewport,
  container: HTMLElement,
): OnScreenCounts {
  // The viewport is already a camera position in canvas units, so the visible rect is that
  // corner plus the container's size scaled down by the zoom.
  const { x: left, y: top, zoom } = viewport
  const w = container.clientWidth / zoom
  const h = container.clientHeight / zoom

  let elements = 0
  const visibleIds = new Set<string>()
  for (const e of fixture.elements) {
    if (e.x < left + w && e.x + e.width > left && e.y < top + h && e.y + e.height > top) {
      elements++
      visibleIds.add(e.id)
    }
  }

  let edges = 0
  for (const edge of fixture.edges) {
    if (visibleIds.has(edge.fromId) || visibleIds.has(edge.toId)) edges++
  }

  return { elements, edges, domNodes: container.querySelectorAll('*').length }
}
