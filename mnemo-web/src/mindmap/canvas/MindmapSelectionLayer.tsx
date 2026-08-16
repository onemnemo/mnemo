/**
 * What a selected edge looks like.
 *
 * Its own layer rather than a state on the edge itself, because an edge has two substrates and only
 * one of them is DOM: at readable zoom the edges are pixels on a canvas, with nothing to put a class
 * on. A separate overlay draws the same highlight in both bands, and it stays cheap because it draws
 * what is selected rather than what exists.
 *
 * Unmounted when nothing is selected, which is why the runtime holds its camera group in a box
 * rather than as a value.
 */

import { useMemo, type Ref } from "react"

import { highlightGeometry } from "./edge-highlight"
import { boxOf, type ElementBox } from "./edge-paths"
import type { Scene } from "../model/scene"

/** Canvas units. Scales with the map, which is what makes it read as attached to the line. */
const END_RADIUS = 4

export function MindmapSelectionLayer({
  scene,
  edgeIds,
  cameraRef,
}: {
  scene: Scene
  edgeIds: ReadonlySet<string>
  cameraRef: Ref<SVGGElement>
}) {
  const boxes = useMemo(() => {
    const index = new Map<string, ElementBox>()
    for (const element of scene.elements) {
      index.set(element.id, boxOf(element))
    }
    return index
  }, [scene])

  const selected = useMemo(
    () => (edgeIds.size === 0 ? [] : scene.edges.filter((edge) => edgeIds.has(edge.id))),
    [scene, edgeIds],
  )

  if (selected.length === 0) {
    return null
  }

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <g ref={cameraRef}>
        {selected.map((edge) => {
          const drawn = highlightGeometry(edge, (id) => boxes.get(id))
          if (!drawn) {
            return null
          }
          return (
            <g key={edge.id} data-mm-selected-edge={edge.id}>
              <path
                d={drawn.path}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={drawn.start.x}
                cy={drawn.start.y}
                r={END_RADIUS}
                fill="var(--canvas)"
                stroke="var(--accent)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={drawn.end.x}
                cy={drawn.end.y}
                r={END_RADIUS}
                fill="var(--canvas)"
                stroke="var(--accent)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
