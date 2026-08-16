import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from '@xyflow/react'
import type { MindmapEdge } from '../../fixture/model'
import type { Edge } from '@xyflow/react'

/**
 * Edges for the React Flow arm.
 *
 * Mnemo has two kinds. Hierarchy edges are structural, never user-selectable, and always a
 * centre-to-centre curve. Link edges are user-created connectors with a colour, caps, a
 * line style, a label and one of three routings. All of it is rendered here, because an
 * arm that draws fewer edge decorations than the product is not faster, it is incomplete.
 *
 * Labels go through React Flow's label renderer rather than an SVG text node, which is
 * what the library does natively, and they carry the level-of-detail class so they stop
 * painting below the chrome threshold exactly as the desktop's do.
 */

const DASH_BY_STYLE: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1 4',
  // A true double line is two parallel strokes; a dense dash reads similarly at a fraction
  // of the cost, and the spike's concern is per-edge cost rather than exact stroke shape.
  double: undefined,
}

function pathFor(props: EdgeProps, routing: string): [string, number, number] {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
  if (routing === 'straight') {
    const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY })
    return [path, labelX, labelY]
  }
  if (routing === 'orthogonal') {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 0,
    })
    return [path, labelX, labelY]
  }
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  return [path, labelX, labelY]
}

interface LinkEdgeData extends Record<string, unknown> {
  readonly routing: string
  readonly lineStyle: string
  readonly thickness: number
  readonly color: string
  readonly label?: string
}

const LinkEdgeImpl = (props: EdgeProps): React.ReactElement => {
  const data = props.data as LinkEdgeData | undefined
  const routing = data?.routing ?? 'curve'
  const [path, labelX, labelY] = pathFor(props, routing)

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: data?.color ?? '#7b869c',
          strokeWidth: data?.thickness ?? 1.5,
          strokeDasharray: DASH_BY_STYLE[data?.lineStyle ?? 'solid'],
        }}
        markerEnd={props.markerEnd}
      />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="spike-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: '#1a1e27',
              color: '#c3cad8',
              padding: '1px 4px',
              borderRadius: 4,
              fontSize: 9,
              pointerEvents: 'none',
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const LinkEdge = memo(LinkEdgeImpl)

const HierarchyEdgeImpl = (props: EdgeProps): React.ReactElement => {
  const [path] = pathFor(props, 'curve')
  return <BaseEdge id={props.id} path={path} style={{ stroke: '#4a5162', strokeWidth: 1.25 }} />
}

export const HierarchyEdge = memo(HierarchyEdgeImpl)

/** Module constant: a fresh object here would remount every edge on every render. */
export const edgeTypes = {
  'mm-hierarchy': HierarchyEdge,
  'mm-link': LinkEdge,
} as const

export function toRfEdges(edges: readonly MindmapEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.fromId,
    target: e.toId,
    type: e.kind === 'hierarchy' ? 'mm-hierarchy' : 'mm-link',
    selectable: e.kind === 'link',
    data:
      e.kind === 'link'
        ? {
            routing: e.routing ?? 'curve',
            lineStyle: e.lineStyle ?? 'solid',
            thickness: e.thickness ?? 1.5,
            color: e.color ?? '#7b869c',
            label: e.label,
          }
        : undefined,
  }))
}
