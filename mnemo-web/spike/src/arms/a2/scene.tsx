import { memo, useEffect, useMemo, useRef } from 'react'
import type { MindmapEdge, MindmapFixture } from '../../fixture/model'
import { anchorsFor, boxOf, edgeGeometry } from './edge-paths'
import { NodeHost } from './nodes'

/**
 * The scene, rendered exactly once.
 *
 * React's job in this arm ends when the last node is in the document. Nothing here subscribes
 * to the camera, nothing re-renders on a gesture, and the handle drives the DOM directly from
 * that point on. Keeping React for the initial render is not a compromise: it is what keeps
 * native text, focus, IME and accessibility, and it is what lets the StrictMode probe sit
 * inside the tree actually under measurement.
 */

const HIERARCHY_STROKE = '#4a5162'
const HIERARCHY_WIDTH = 1.25
const LINK_STROKE = '#7b869c'
const LINK_WIDTH = 1.5

const DASH_BY_STYLE: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1 4',
  // A true double line is two parallel strokes; a dense dash reads similarly at a fraction of
  // the cost, and the spike's concern is per-edge cost rather than exact stroke shape. Matches
  // the choice a1 made, so neither arm draws more than the other.
  double: undefined,
}

interface EdgeVisual {
  readonly edge: MindmapEdge
  readonly path: string
  readonly labelX: number
  readonly labelY: number
}

function buildEdgeVisuals(fixture: MindmapFixture): readonly EdgeVisual[] {
  const boxes = new Map(fixture.elements.map((e) => [e.id, boxOf(e)]))
  const visuals: EdgeVisual[] = []
  for (const edge of fixture.edges) {
    const from = boxes.get(edge.fromId)
    const to = boxes.get(edge.toId)
    if (!from || !to) continue
    const geometry = edgeGeometry(edge.routing ?? 'curve', anchorsFor(from, to))
    visuals.push({ edge, path: geometry.path, labelX: geometry.label.x, labelY: geometry.label.y })
  }
  return visuals
}

/**
 * Edges live in a viewport-sized SVG that sits beside the world rather than inside it, with the
 * camera on an inner group. A canvas-sized SVG is a box tens of thousands of pixels across, and
 * having one under a transformed ancestor cost a frame on every pan even with all of its paths
 * hidden.
 */
const EdgeLayer = memo(function EdgeLayer({
  visuals,
  cameraRef,
}: {
  visuals: readonly EdgeVisual[]
  cameraRef: React.Ref<SVGGElement>
}) {
  return (
    <svg className="a2-edges">
      {/* Paths carry canvas coordinates and this group maps them to the screen, so a moved
          element's path can be rewritten straight from its position. */}
      <g ref={cameraRef}>
        {visuals.map(({ edge, path }) => (
          <path
            key={edge.id}
            data-mm-edge={edge.id}
            d={path}
            fill="none"
            stroke={edge.kind === 'hierarchy' ? HIERARCHY_STROKE : (edge.color ?? LINK_STROKE)}
            strokeWidth={edge.kind === 'hierarchy' ? HIERARCHY_WIDTH : (edge.thickness ?? LINK_WIDTH)}
            strokeDasharray={edge.kind === 'hierarchy' ? undefined : DASH_BY_STYLE[edge.lineStyle ?? 'solid']}
          />
        ))}
      </g>
    </svg>
  )
})

const EdgeLabelLayer = memo(function EdgeLabelLayer({ visuals }: { visuals: readonly EdgeVisual[] }) {
  return (
    <div className="a2-edge-labels">
      {visuals
        .filter((visual) => visual.edge.label)
        .map((visual) => (
          <div
            key={visual.edge.id}
            className="spike-edge-label"
            data-mm-edge-label={visual.edge.id}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${visual.labelX}px, ${visual.labelY}px)`,
              background: '#1a1e27',
              color: '#c3cad8',
              padding: '1px 4px',
              borderRadius: 4,
              fontSize: 9,
              pointerEvents: 'none',
            }}
          >
            {visual.edge.label}
          </div>
        ))}
    </div>
  )
})

const NodeLayer = memo(function NodeLayer({ fixture }: { fixture: MindmapFixture }) {
  return (
    <>
      {fixture.elements.map((element) => (
        <NodeHost key={element.id} element={element} />
      ))}
    </>
  )
})

export interface SceneProps {
  readonly fixture: MindmapFixture
  /** Whether the world gets its own composited layer. Priced, not assumed; see arm.css. */
  readonly promoteLayer: boolean
  /**
   * Whether edges are drawn at all. A diagnostic arm in the same spirit as running with level
   * of detail forced off: never gating, because a mindmap without its edges is not the product,
   * but the only way to attribute a cost to the edge layer rather than argue about it.
   */
  readonly renderEdges: boolean
  /** Called once, with the pane, the world layer and the edge camera group, once all are up. */
  readonly onMounted: (
    pane: HTMLDivElement,
    world: HTMLDivElement,
    edgeCamera: SVGGElement | null,
  ) => void
}

export function Scene({
  fixture,
  promoteLayer,
  renderEdges,
  onMounted,
}: SceneProps): React.ReactElement {
  const paneRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const edgeCameraRef = useRef<SVGGElement>(null)
  const visuals = useMemo(
    () => (renderEdges ? buildEdgeVisuals(fixture) : []),
    [fixture, renderEdges],
  )

  useEffect(() => {
    const pane = paneRef.current
    const world = worldRef.current
    if (pane && world) onMounted(pane, world, edgeCameraRef.current)
  }, [onMounted])

  return (
    <div ref={paneRef} className="a2-pane">
      {/* Before the world in document order, so edges paint under the elements they connect. */}
      {renderEdges ? <EdgeLayer visuals={visuals} cameraRef={edgeCameraRef} /> : null}
      <div ref={worldRef} className={promoteLayer ? 'a2-world a2-world--layer' : 'a2-world'}>
        {renderEdges ? <EdgeLabelLayer visuals={visuals} /> : null}
        <NodeLayer fixture={fixture} />
      </div>
    </div>
  )
}
