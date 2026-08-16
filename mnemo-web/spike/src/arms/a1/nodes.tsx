import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type {
  CodeContent,
  FrameContent,
  FreeTextContent,
  CanvasImageContent,
  LinkContent,
  RefContent,
  ShapeContent,
  TaskContent,
  TextContent,
} from '../../fixture/model'
import { MathNode } from './math-node'

/**
 * One component per content kind, every one of them memoized.
 *
 * The memoization is not a micro-optimization here, it decides whether this arm's numbers
 * mean anything. React Flow re-renders from a store on every viewport change, and a
 * published benchmark shows a single unmemoized prop dropping a hundred-node graph to
 * about ten frames a second. An unmemoized arm would fail every threshold without ever
 * reaching React Flow's real ceiling, and the spike would report a no-go that says
 * nothing about React Flow.
 *
 * The same reasoning is why the `nodeTypes` map at the bottom is a module constant. Built
 * inline it would be a new object on every render, and React Flow remounts every node
 * when that map's identity changes.
 *
 * Level of detail is deliberately absent from this file. Chrome elements are always
 * rendered and CSS hides them per zoom band, so crossing a threshold costs one attribute
 * write rather than a re-render of every mounted node.
 */

// Handles exist because React Flow routes edges through them. They are visually
// suppressed, since Mnemo's edges anchor to element geometry rather than to ports.
const HIDDEN_HANDLE: React.CSSProperties = { opacity: 0, pointerEvents: 'none' }

function Anchors(): React.ReactElement {
  return (
    <>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
    </>
  )
}

export const TextNode = memo(function TextNode({ data }: { data: { content: TextContent } }) {
  return (
    <div className="spike-node">
      <Anchors />
      <span className="spike-label">{data.content.text}</span>
    </div>
  )
})

export const TaskNode = memo(function TaskNode({ data }: { data: { content: TaskContent } }) {
  const { done, text } = data.content
  return (
    <div className="spike-node">
      <Anchors />
      <span className={done ? 'spike-checkbox spike-checkbox--done' : 'spike-checkbox'} />
      <span className={done ? 'spike-label spike-label--done' : 'spike-label'}>{text}</span>
    </div>
  )
})

export const CodeNode = memo(function CodeNode({ data }: { data: { content: CodeContent } }) {
  return (
    <div className="spike-node">
      <Anchors />
      <span className="spike-code">{data.content.source}</span>
      <span className="spike-chip">{data.content.language}</span>
    </div>
  )
})

export const LinkNode = memo(function LinkNode({ data }: { data: { content: LinkContent } }) {
  return (
    <div className="spike-node">
      <Anchors />
      <span className="spike-glyph" />
      <span className="spike-label">{data.content.title}</span>
    </div>
  )
})

export const RefNode = memo(function RefNode({ data }: { data: { content: RefContent } }) {
  const { title, badge, missing } = data.content
  return (
    <div className="spike-node">
      <Anchors />
      <span className="spike-glyph" />
      <span className={missing ? 'spike-label spike-label--missing' : 'spike-label'}>{title}</span>
      {badge ? <span className="spike-chip">{badge}</span> : null}
    </div>
  )
})

export const ShapeNode = memo(function ShapeNode({ data }: { data: { content: ShapeContent } }) {
  // A real implementation draws seven distinct geometries; the spike keeps the DOM shape
  // and text identical across them and varies only the clip path, because the cost being
  // measured is per-element DOM and paint, not the path data itself.
  return (
    <div className="spike-node spike-shape" data-shape={data.content.shape}>
      <Anchors />
      {data.content.text ? <span className="spike-label spike-label--center">{data.content.text}</span> : null}
    </div>
  )
})

export const FreeTextNode = memo(function FreeTextNode({
  data,
}: {
  data: { content: FreeTextContent }
}) {
  return (
    <div className="spike-node">
      <Anchors />
      <span className="spike-label">{data.content.text}</span>
    </div>
  )
})

export const ImageNode = memo(function ImageNode({
  data,
}: {
  data: { content: CanvasImageContent; src: string }
}) {
  return (
    <div className="spike-node">
      <Anchors />
      {/* Decoding async keeps a large image out of the critical path of a frame, which is
          what a real canvas would want too. */}
      <img className="spike-image" src={data.src} alt="" decoding="async" draggable={false} />
    </div>
  )
})

export const FrameNode = memo(function FrameNode({ data }: { data: { content: FrameContent } }) {
  return (
    <div className="spike-frame">
      <Anchors />
      <div className="spike-frame-title">{data.content.title}</div>
    </div>
  )
})

/**
 * Module constant on purpose. A fresh object here remounts every node on every render.
 */
export const nodeTypes = {
  'mm-text': TextNode,
  'mm-task': TaskNode,
  'mm-code': CodeNode,
  'mm-math': MathNode,
  'mm-link': LinkNode,
  'mm-ref': RefNode,
  'mm-shape': ShapeNode,
  'mm-freetext': FreeTextNode,
  'mm-image': ImageNode,
  'mm-frame': FrameNode,
} as const

export type SpikeNodeType = keyof typeof nodeTypes
