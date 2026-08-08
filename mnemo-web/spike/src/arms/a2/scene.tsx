import { memo, useEffect, useMemo, useRef } from 'react'
import type { MindmapEdge, MindmapFixture } from '../../fixture/model'
import { anchorsFor, boxOf, edgeGeometry, edgeShape } from './edge-paths'
import { dashAttribute, strokeStyleFor, type EdgeMode } from './edge-style'
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

interface EdgeLabelVisual {
  readonly edge: MindmapEdge
  readonly labelX: number
  readonly labelY: number
}

interface EdgeVisual extends EdgeLabelVisual {
  readonly path: string
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
 * Label positions only, for the canvas mode, which has no paths to build.
 *
 * Separate from the visuals above rather than a flag on them because building four and a half
 * thousand `d` strings that nothing will ever read would charge the canvas mode for work the
 * mode exists to avoid, and it would land inside the mount time the harness records.
 */
function buildEdgeLabelVisuals(fixture: MindmapFixture): readonly EdgeLabelVisual[] {
  const boxes = new Map(fixture.elements.map((e) => [e.id, boxOf(e)]))
  const visuals: EdgeLabelVisual[] = []
  for (const edge of fixture.edges) {
    if (!edge.label) continue
    const from = boxes.get(edge.fromId)
    const to = boxes.get(edge.toId)
    if (!from || !to) continue
    const { label } = edgeShape(edge.routing ?? 'curve', anchorsFor(from, to))
    visuals.push({ edge, labelX: label.x, labelY: label.y })
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
        {visuals.map(({ edge, path }) => {
          const style = strokeStyleFor(edge)
          return (
            <path
              key={edge.id}
              data-mm-edge={edge.id}
              d={path}
              fill="none"
              stroke={style.color}
              strokeWidth={style.width}
              strokeDasharray={dashAttribute(style.dash)}
            />
          )
        })}
      </g>
    </svg>
  )
})

/**
 * Labels are DOM in every mode that draws edges, canvas included. Canvas text is laid out and
 * rasterised differently from DOM text, so drawing them on the canvas would change what is on
 * screen and make the two edge modes incomparable on the thing being measured.
 */
const EdgeLabelLayer = memo(function EdgeLabelLayer({
  visuals,
}: {
  visuals: readonly EdgeLabelVisual[]
}) {
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

/** Everything the handle needs from the rendered tree, reported once. */
export interface MountedScene {
  readonly pane: HTMLDivElement
  readonly world: HTMLDivElement
  /** The SVG camera group, present only in svg mode. */
  readonly edgeCamera: SVGGElement | null
  /** The edge canvas, present only in canvas mode. */
  readonly edgeCanvas: HTMLCanvasElement | null
}

export interface SceneProps {
  readonly fixture: MindmapFixture
  /** Whether the world gets its own composited layer. Priced, not assumed; see arm.css. */
  readonly promoteLayer: boolean
  /**
   * Which substrate draws the edges, or `off` to draw none.
   *
   * `off` is a diagnostic arm in the same spirit as running with level of detail forced off:
   * never gating, because a mindmap without its edges is not the product, but the only way to
   * attribute a cost to the edge layer rather than argue about it. It is what located the fixed
   * per-gesture frame that `canvas` exists to remove.
   */
  readonly edgeMode: EdgeMode
  /** Called once, with the pane, the world layer and whichever edge substrate is in play. */
  readonly onMounted: (mounted: MountedScene) => void
}

export function Scene({
  fixture,
  promoteLayer,
  edgeMode,
  onMounted,
}: SceneProps): React.ReactElement {
  const paneRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const edgeCameraRef = useRef<SVGGElement>(null)
  const edgeCanvasRef = useRef<HTMLCanvasElement>(null)
  const pathVisuals = useMemo(
    () => (edgeMode === 'svg' ? buildEdgeVisuals(fixture) : []),
    [fixture, edgeMode],
  )
  const labelVisuals = useMemo(
    () =>
      edgeMode === 'svg'
        ? pathVisuals
        : edgeMode === 'canvas'
          ? buildEdgeLabelVisuals(fixture)
          : [],
    [fixture, edgeMode, pathVisuals],
  )

  useEffect(() => {
    const pane = paneRef.current
    const world = worldRef.current
    if (!pane || !world) return
    onMounted({
      pane,
      world,
      edgeCamera: edgeCameraRef.current,
      edgeCanvas: edgeCanvasRef.current,
    })
  }, [onMounted])

  return (
    <div ref={paneRef} className="a2-pane">
      {/* Before the world in document order, so edges paint under the elements they connect. */}
      {edgeMode === 'svg' ? <EdgeLayer visuals={pathVisuals} cameraRef={edgeCameraRef} /> : null}
      {/* Viewport-sized like the SVG layer, and for the same reason: the camera goes into the
          drawing, not into a box tens of thousands of pixels across. */}
      {edgeMode === 'canvas' ? <canvas ref={edgeCanvasRef} className="a2-edge-canvas" /> : null}
      <div ref={worldRef} className={promoteLayer ? 'a2-world a2-world--layer' : 'a2-world'}>
        {edgeMode === 'off' ? null : <EdgeLabelLayer visuals={labelVisuals} />}
        <NodeLayer fixture={fixture} />
      </div>
    </div>
  )
}
