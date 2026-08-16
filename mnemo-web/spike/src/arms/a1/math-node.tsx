import { memo, useEffect, useRef } from 'react'
import { fitMathIntoBox } from '../shared/math'
import type { MathContent } from '../../fixture/model'

/**
 * A node whose content is live LaTeX, fitted into a fixed box.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * **The outer box never changes size.** Its width and height come from the element, and
 * the KaTeX host is absolutely positioned inside it. React Flow measures nodes with a
 * ResizeObserver, so content that could resize its own node would feed a measurement back
 * into the layout that produced it. Pinning the box makes that structurally impossible
 * rather than merely unlikely.
 *
 * The fit itself lives in the shared module, because both arms have to size math the same way
 * or a difference in how they measure would show up as a difference in what they cost.
 */

export interface MathNodeData {
  readonly content: MathContent
  readonly width: number
  readonly height: number
  readonly onMeasured?: (id: string, scale: number, natural: { w: number; h: number }) => void
  readonly id: string
}

function MathNodeImpl({ data }: { data: MathNodeData }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const fit = fitMathIntoBox(host, data.content.latex, data.width, data.height)
    data.onMeasured?.(data.id, fit.scale, fit.natural)
  }, [data])

  return (
    <div className="spike-node spike-math">
      <div ref={hostRef} className="spike-math-host" />
    </div>
  )
}

export const MathNode = memo(MathNodeImpl)
