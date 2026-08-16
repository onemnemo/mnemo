import { memo, useEffect, useRef } from 'react'
import type { MathContent, MindmapElement } from '../../fixture/model'
import { fitMathIntoBox } from '../shared/math'
import { imageUrlFor } from '../shared/assets'

/**
 * Node presentation for the hand-rolled arm.
 *
 * This deliberately mirrors `a1/nodes.tsx` class for class and child for child, because the two
 * arms share `shared/arm.css` and the whole comparison rests on them painting the same thing.
 * The one difference is that React Flow's source and target handles are gone: they exist so
 * React Flow can route edges through ports, and a renderer that anchors edges to element
 * geometry has no use for them. That is two fewer DOM nodes per element, ten thousand across the
 * fixture, and it is a real architectural difference rather than a shortcut. It is also visible
 * in every run: `onScreen.domNodes` is recorded for both arms.
 *
 * These components render ONCE. Position, selection and level of detail are all written
 * imperatively afterwards, so nothing here subscribes to a viewport, and a pan re-renders
 * nothing at all. That is the arm's entire thesis, and putting it in the markup rather than in
 * a memo comparison is what makes it structural instead of hopeful.
 */

function MathBody({ content, width, height }: { content: MathContent; width: number; height: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host) fitMathIntoBox(host, content.latex, width, height)
  }, [content.latex, width, height])

  return <div ref={hostRef} className="spike-math-host" />
}

function NodeBody({ element }: { element: MindmapElement }): React.ReactElement {
  const content = element.content

  switch (content.kind) {
    case 'task':
      return (
        <>
          <span className={content.done ? 'spike-checkbox spike-checkbox--done' : 'spike-checkbox'} />
          <span className={content.done ? 'spike-label spike-label--done' : 'spike-label'}>
            {content.text}
          </span>
        </>
      )
    case 'code':
      return (
        <>
          <span className="spike-code">{content.source}</span>
          <span className="spike-chip">{content.language}</span>
        </>
      )
    case 'math':
      return <MathBody content={content} width={element.width} height={element.height} />
    case 'link':
      return (
        <>
          <span className="spike-glyph" />
          <span className="spike-label">{content.title}</span>
        </>
      )
    case 'note':
    case 'flashcard':
      return (
        <>
          <span className="spike-glyph" />
          <span className={content.missing ? 'spike-label spike-label--missing' : 'spike-label'}>
            {content.title}
          </span>
          {content.badge ? <span className="spike-chip">{content.badge}</span> : null}
        </>
      )
    case 'shape':
      return content.text ? <span className="spike-label spike-label--center">{content.text}</span> : <></>
    case 'image':
      return (
        // Decoding async keeps a large image out of the critical path of a frame, which is what
        // a real canvas would want too.
        <img
          className="spike-image"
          src={imageUrlFor(content.assetId)}
          alt=""
          decoding="async"
          draggable={false}
        />
      )
    case 'frame':
      return <div className="spike-frame-title">{content.title}</div>
    default:
      return <span className="spike-label">{content.text}</span>
  }
}

/** The inner box's class, matching the wrapper a1 gives each content kind. */
function bodyClassName(element: MindmapElement): string {
  switch (element.content.kind) {
    case 'frame':
      return 'spike-frame'
    case 'math':
      return 'spike-node spike-math'
    case 'shape':
      return 'spike-node spike-shape'
    default:
      return 'spike-node'
  }
}

/**
 * One element: an absolutely positioned host carrying the id and the initial transform, and an
 * inner box carrying the presentation. Two levels, the same as React Flow's node wrapper plus
 * the shared `.spike-node`, so neither arm gains a level of nesting the other pays for.
 */
export const NodeHost = memo(function NodeHost({ element }: { element: MindmapElement }) {
  return (
    <div
      className="a2-node"
      data-mm-id={element.id}
      style={{
        width: element.width,
        height: element.height,
        transform: `translate(${element.x}px, ${element.y}px)`,
      }}
    >
      <div
        className={bodyClassName(element)}
        data-shape={element.content.kind === 'shape' ? element.content.shape : undefined}
      >
        <NodeBody element={element} />
      </div>
    </div>
  )
})
